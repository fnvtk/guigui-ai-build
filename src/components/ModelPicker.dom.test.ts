// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, InstanceInfo } from "@/state/store";

const fixture = vi.hoisted(() => ({ dispatch: vi.fn(), instances: [] as InstanceInfo[] }));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => true }));
vi.mock("@/state/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/state/store")>()),
  useStore: () => ({ state: { instances: fixture.instances, bots: [], modelVariantSessions: {} }, dispatch: fixture.dispatch }),
}));
const { ModelPicker } = await import("./ModelPicker");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const simpleApi: InstanceInfo = {
  instanceId: "simple", driverKind: "openai-compat", displayName: "SimpleAPI", access: "api",
  snapshot: { state: "available" }, models: { default: "kr-pro", options: [
    { id: "kr-max", label: "Max" }, { id: "kr-pro", label: "Pro" }, { id: "kr-mini", label: "Mini" },
  ] },
};
const bot: Bot = {
  id: "scout", threadId: "thread-scout", name: "Scout", title: "", description: "", notifications: true,
  color: "green", unread: false, messages: [], modelSelection: { instanceId: "simple", model: "kr-pro" },
};
let host: HTMLDivElement;
let root: Root;
const trigger = () => host.querySelector<HTMLButtonElement>('[data-tour="model"]')!;
const menu = () => document.querySelector<HTMLElement>("[data-model-picker-content]");
const open = () => act(() => trigger().click());
beforeEach(() => {
  fixture.instances = [simpleApi];
  fixture.dispatch.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(createElement(ModelPicker, { bot, threadId: bot.threadId })));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("the service tier picker in the DOM", () => {
  it("opens an accessible dialog with exactly the three tier choices", () => {
    open();
    expect(menu()?.getAttribute("role")).toBe("dialog");
    expect(menu()?.getAttribute("aria-label")).toBe("选择乖乖 AI 服务档位");
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(Array.from(menu()?.querySelectorAll<HTMLButtonElement>("[data-service-tier]") ?? []).map((button) => button.textContent?.trim()))
      .toEqual(["Max更强，适合复杂任务", "Pro均衡，适合日常工作当前", "Mini更快，适合简单问题"]);
    expect(document.body.textContent).not.toContain("SimpleAPI");
  });

  it("closes after a click outside without changing the selected tier", () => {
    open();
    const outside = document.createElement("button");
    document.body.append(outside);
    act(() => outside.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
    expect(menu()).toBeNull();
    expect(fixture.dispatch).not.toHaveBeenCalled();
    outside.remove();
  });
});
