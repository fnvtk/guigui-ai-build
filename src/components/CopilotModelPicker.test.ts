import { Children, createElement, isValidElement, type ChangeEvent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import type { AppState, Bot, InstanceInfo } from "@/state/store";
import { modelSwitchNeedsAsk } from "../../shared/approval-mode";
import { Select } from "./Select";

const fixture = vi.hoisted(() => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  return { instances: [] as InstanceInfo[], modelVariantSessions: {} as AppState["modelVariantSessions"], dispatch: vi.fn(),
    values: [] as unknown[], index: 0, own: 0 };
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
vi.mock("./MenuMotion", () => ({ useMenuMotion: (open: boolean) => ({ shown: open, closing: false, className: "" }) }));
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => false, setAdvancedMode: () => {} }));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => true }));
vi.mock("@/state/store", async (original) => ({
  ...await original<typeof import("@/state/store")>(),
  useStore: () => ({ state: { instances: fixture.instances, bots: [], modelVariantSessions: fixture.modelVariantSessions }, dispatch: fixture.dispatch,
    refreshInstances: vi.fn(() => Promise.resolve()), refreshModels: vi.fn(() => Promise.resolve()) }),
}));
const { ModelPicker, ModelVariantRow, modelSelectionForPick } = await import("./ModelPicker");
beforeEach(() => {
  fixture.dispatch.mockClear(); fixture.modelVariantSessions = {};
  fixture.values = []; fixture.index = 0; fixture.own = 0;
});

const copilot = (): InstanceInfo => ({
  instanceId: "githubCopilot", displayName: "GitHub Copilot", driverKind: "copilotAgent", access: "subscription",
  snapshot: { state: "available", authenticated: true }, capabilities: { modelVariants: true }, models: { default: "auto", options: [
    { id: "auto", label: "Copilot auto" }, { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", variants: [
      { id: "low", label: "Low" }, { id: "high", label: "High" },
    ] },
  ] },
});
const claude = (): InstanceInfo => ({
  instanceId: "claude", displayName: "Claude", driverKind: "claudeAgent", access: "subscription",
  snapshot: { state: "available", authenticated: true }, models: { default: "claude-sonnet-5", options: [{ id: "claude-sonnet-5", label: "Sonnet" }] },
});
const bot = (instanceId: string, model: string): Bot => ({
  id: "bot-hopper", threadId: "thread-hopper", name: "Hopper", title: "", description: "", notifications: true,
  color: "green", unread: false, messages: [], modelSelection: { instanceId, model },
});
type Element = ReactElement<Record<string, unknown> & { children?: ReactNode; onChange?: (event: ChangeEvent<HTMLSelectElement>) => void }>;
function elements(value: ReactNode): Element[] {
  return Children.toArray(value).flatMap((child) => isValidElement(child) ? [child as Element, ...elements((child as Element).props.children)] : []);
}
function renderPicker(selected: Bot) {
  fixture.values.length = Math.min(fixture.values.length, fixture.own);
  let tree: ReactNode = null;
  function Capture() {
    fixture.index = 0;
    tree = ModelPicker({ bot: selected, threadId: selected.threadId });
    fixture.own = fixture.index;
    return tree;
  }
  return { html: renderToStaticMarkup(createElement(Capture)), nodes: elements(tree) };
}
function openPicker(selected: Bot) {
  const trigger = renderPicker(selected).nodes.find((entry) => entry.props["data-tour"] === "model")!;
  (trigger.props.onClick as () => void)();
  return renderPicker(selected);
}
it("does not expose Copilot model IDs in the product picker", () => {
  fixture.instances = [claude(), copilot()];
  const opened = openPicker(bot("githubCopilot", "auto"));
  expect(opened.html).toContain("选择服务档位");
  expect(opened.html).toContain("乖乖 AI 服务暂未连接");
  expect(opened.html).not.toContain("Claude");
  expect(opened.html).not.toContain("GitHub Copilot");
  expect(opened.html).not.toContain("claude-haiku-4.5");
  expect(opened.html).not.toContain("gpt-5.6-luna");
  expect(fixture.dispatch).not.toHaveBeenCalled();
});

it("offers the picked Copilot model's own effort levels", () => {
  fixture.instances = [copilot()];
  const selected = bot("githubCopilot", "gpt-5.6-luna");
  const row = ModelVariantRow({ bot: selected, threadId: selected.threadId, updateBotDefault: true, compact: true });
  const select = elements(row).find((entry) => entry.type === Select)!;
  select.props.onChange!({ target: { value: "1" } } as ChangeEvent<HTMLSelectElement>);
  expect(fixture.dispatch).toHaveBeenCalledExactlyOnceWith({ type: "setModel", botId: selected.id, threadId: selected.threadId,
    updateBotDefault: true, selection: { instanceId: "githubCopilot", model: "gpt-5.6-luna", variant: "high" } });
});

it("moves between Claude and Copilot without an approval reset", () => {
  fixture.instances = [claude(), copilot()];
  const toCopilot = modelSelectionForPick(bot("claude", "claude-sonnet-5").modelSelection, copilot(), "claude-haiku-4.5");
  expect(toCopilot).toEqual({ instanceId: "githubCopilot", model: "claude-haiku-4.5" });
  expect(modelSelectionForPick(toCopilot, claude(), "claude-sonnet-5")).toEqual({ instanceId: "claude", model: "claude-sonnet-5" });
  for (const mode of ["ask", "auto", "full"] as const) {
    expect(modelSwitchNeedsAsk(mode, "claudeAgent", "copilotAgent")).toBe(false);
    expect(modelSwitchNeedsAsk(mode, "copilotAgent", "customAcp")).toBe(false);
    expect(modelSwitchNeedsAsk(mode, "customAcp", "claudeAgent")).toBe(false);
    expect(modelSwitchNeedsAsk(mode, "copilotAgent", "claudeAgent")).toBe(false);
  }
});
