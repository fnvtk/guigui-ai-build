import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, InstanceInfo } from "@/state/store";

const fixture = vi.hoisted(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  return {
    ownerOrAdmin: false as boolean | null,
    values: [] as unknown[],
    index: 0,
    own: 0,
    instances: [] as InstanceInfo[],
    dispatch: vi.fn(),
  };
});
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = fixture.index++;
    if (!(index in fixture.values)) fixture.values[index] = typeof initial === "function" ? initial() : initial;
    return [fixture.values[index], (next: unknown) => {
      fixture.values[index] = typeof next === "function" ? next(fixture.values[index]) : next;
    }];
  },
  useEffect: () => {},
}));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => fixture.ownerOrAdmin }));
vi.mock("@/state/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/state/store")>()),
  useStore: () => ({ state: { instances: fixture.instances, bots: [], modelVariantSessions: {} }, dispatch: fixture.dispatch }),
}));

const { ModelPicker, SIMPLE_POPOVER_WIDTH } = await import("./ModelPicker");
afterAll(() => vi.unstubAllGlobals());

type Node = ReactElement<Record<string, unknown> & { children?: ReactNode }>;
function nodes(value: ReactNode): Node[] {
  return Children.toArray(value).flatMap((child) => {
    if (!isValidElement(child)) return [];
    const node = child as Node;
    return [node, ...nodes(node.props.children)];
  });
}
const simpleApi: InstanceInfo = {
  instanceId: "guai-simple-api", driverKind: "openai-compat", displayName: "SimpleAPI", access: "api",
  snapshot: { state: "available" }, models: { default: "kr-pro", options: [
    { id: "kr-max", label: "Max" }, { id: "kr-pro", label: "Pro" }, { id: "kr-mini", label: "Mini" },
  ] },
};
const bot = (model = "gpt-5.6"): Bot => ({
  id: "scout", threadId: "thread-scout", name: "Scout", title: "", description: "", notifications: true,
  color: "green", unread: false, messages: [], modelSelection: { instanceId: "old-codex", model },
});

function render(candidate = bot(), includeThreadId = true) {
  fixture.values.length = Math.min(fixture.values.length, fixture.own);
  let tree: ReactNode = null;
  function Capture() {
    fixture.index = 0;
    tree = ModelPicker({ bot: candidate, ...(includeThreadId ? { threadId: candidate.threadId } : {}) });
    fixture.own = fixture.index;
    return tree;
  }
  const html = renderToStaticMarkup(createElement(Capture));
  return { html, nodes: nodes(tree) };
}
const click = (node: Node) => (node.props.onClick as () => void)();

beforeEach(() => {
  fixture.ownerOrAdmin = false;
  fixture.values = [];
  fixture.index = 0;
  fixture.own = 0;
  fixture.instances = [simpleApi];
  fixture.dispatch.mockReset();
});

describe("乖乖 AI service tier picker", () => {
  it("offers only the three product tiers and maps a legacy selection to a safe label", () => {
    expect(SIMPLE_POPOVER_WIDTH).toBe(300);
    const closed = render();
    expect(closed.html).toContain(">Pro</button>");
    click(closed.nodes.find((node) => node.props["data-tour"] === "model")!);
    const opened = render();
    expect(opened.nodes.filter((node) => node.props["data-service-tier"] !== undefined).map((node) => node.props["data-service-tier"]))
      .toEqual(["kr-max", "kr-pro", "kr-mini"]);
    expect(opened.html).not.toContain("GPT-5.6");
    expect(opened.html).not.toContain("SimpleAPI");
    expect(opened.html).not.toContain("Thinking");
    expect(opened.html).not.toContain("Manage AI accounts");
  });

  it("writes the selected alias to the SimpleAPI instance without changing a guest's shared default", () => {
    const closed = render();
    click(closed.nodes.find((node) => node.props["data-tour"] === "model")!);
    const opened = render();
    click(opened.nodes.find((node) => node.props["data-service-tier"] === "kr-mini")!);
    expect(fixture.dispatch).toHaveBeenCalledWith({
      type: "setModel", botId: "scout", threadId: "thread-scout", updateBotDefault: false,
      selection: { instanceId: "guai-simple-api", model: "kr-mini" },
    });
  });

  it("keeps the owner path that updates the bot default for a thread pick", () => {
    fixture.ownerOrAdmin = true;
    const closed = render();
    click(closed.nodes.find((node) => node.props["data-tour"] === "model")!);
    const opened = render();
    click(opened.nodes.find((node) => node.props["data-service-tier"] === "kr-max")!);
    expect(fixture.dispatch).toHaveBeenCalledWith(expect.objectContaining({ updateBotDefault: true,
      selection: { instanceId: "guai-simple-api", model: "kr-max" } }));
  });

  it("does not let a non-owner change the shared default from the contained bot setting", () => {
    const candidate = bot();
    const closed = render(candidate, false);
    click(closed.nodes.find((node) => node.props["data-tour"] === "model")!);
    const opened = render(candidate, false);
    click(opened.nodes.find((node) => node.props["data-service-tier"] === "kr-mini")!);
    expect(fixture.dispatch).toHaveBeenCalledWith(expect.objectContaining({ updateBotDefault: false,
      selection: { instanceId: "guai-simple-api", model: "kr-mini" } }));
  });

  it("disables all tiers if the SimpleAPI instance is absent", () => {
    fixture.instances = [];
    const closed = render();
    click(closed.nodes.find((node) => node.props["data-tour"] === "model")!);
    const opened = render();
    expect(opened.nodes.filter((node) => node.props["data-service-tier"] !== undefined).every((node) => node.props.disabled)).toBe(true);
    expect(opened.html).toContain("乖乖 AI 服务暂未连接");
    expect(fixture.dispatch).not.toHaveBeenCalled();
  });

  it("offers only tiers advertised by the SimpleAPI catalog", () => {
    fixture.instances = [{ ...simpleApi, models: { default: "kr-pro", options: [{ id: "kr-pro", label: "Pro" }] } }];
    const closed = render();
    click(closed.nodes.find((node) => node.props["data-tour"] === "model")!);
    const opened = render();
    expect(opened.nodes.filter((node) => node.props["data-service-tier"] !== undefined).map((node) => node.props["data-service-tier"]))
      .toEqual(["kr-pro"]);
  });
});
