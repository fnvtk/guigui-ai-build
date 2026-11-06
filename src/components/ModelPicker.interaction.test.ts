// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, InstanceInfo } from "@/state/store";

const fixture = vi.hoisted(() => ({ dispatch: vi.fn(), instances: [] as InstanceInfo[] }));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => false }));
vi.mock("@/state/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/state/store")>()),
  useStore: () => ({ state: { instances: fixture.instances, bots: [], modelVariantSessions: {} }, dispatch: fixture.dispatch }),
}));
const { ModelPicker } = await import("./ModelPicker");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const modelInstance = (instanceId: string, driverKind: string, displayName: string): InstanceInfo => ({
  instanceId, driverKind, displayName, access: "api", snapshot: { state: "available" },
  models: { default: "gpt-5.6", options: [{ id: "gpt-5.6", label: "GPT-5.6" }] },
});
const simpleApi = { ...modelInstance("simple", "openai-compat", "SimpleAPI"), models: { default: "kr-pro", options: [
  { id: "kr-max", label: "Max" }, { id: "kr-pro", label: "Pro" }, { id: "kr-mini", label: "Mini" },
] } };
const bot: Bot = {
  id: "scout", threadId: "thread-scout", name: "Scout", title: "", description: "", notifications: true,
  color: "green", unread: false, messages: [], modelSelection: { instanceId: "codex", model: "gpt-5.6" },
};
let host: HTMLDivElement;
let root: Root;
const menu = () => document.querySelector<HTMLElement>("[data-model-picker-content]");
const open = () => act(() => host.querySelector<HTMLButtonElement>('[data-tour="model"]')!.click());
beforeEach(() => {
  fixture.instances = [modelInstance("codex", "codex", "Codex"), simpleApi];
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

describe("product model picker interactions", () => {
  it("offers only tiers and writes the selected service alias on the SimpleAPI instance", () => {
    open();
    expect(menu()?.textContent).toContain("Max");
    expect(menu()?.textContent).toContain("Pro");
    expect(menu()?.textContent).toContain("Mini");
    expect(menu()?.textContent).not.toContain("GPT-5.6");
    expect(menu()?.textContent).not.toContain("Codex");
    expect(menu()?.querySelectorAll("[data-service-tier]")).toHaveLength(3);
    act(() => menu()?.querySelector<HTMLButtonElement>('[data-service-tier="kr-mini"]')?.click());
    expect(fixture.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: "setModel", updateBotDefault: false, selection: { instanceId: "simple", model: "kr-mini" },
    }));
    expect(menu()).toBeNull();
  });

  it("does not expose provider setup or allow a pick when the product instance is absent", () => {
    fixture.instances = [modelInstance("codex", "codex", "Codex")];
    act(() => root.render(createElement(ModelPicker, { bot, threadId: bot.threadId })));
    open();
    expect(menu()?.textContent).toContain("乖乖 AI 服务暂未连接");
    expect(menu()?.textContent).not.toContain("Codex");
    expect(menu()?.textContent).not.toContain("设置");
    expect(Array.from(menu()?.querySelectorAll<HTMLButtonElement>("button") ?? []).every((button) => button.disabled)).toBe(true);
  });

  it("closes on Escape", () => {
    open();
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(menu()).toBeNull();
  });
});
