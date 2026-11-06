// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Bot, InstanceInfo } from "@/state/store";

const fixture = vi.hoisted(() => ({ dispatch: (() => {}) as (...args: unknown[]) => void, instances: [] as unknown[], advanced: true,
  refreshInstances: (() => Promise.resolve()) as () => Promise<void>, refreshModels: ((_id: string) => Promise.resolve()) as (id: string) => Promise<void> }));
const api = vi.hoisted(() => vi.fn());
vi.mock("@/state/api", () => ({ api, ApiError: Error }));
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => fixture.advanced, setAdvancedMode: () => {} }));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => true }));
// The store's refresh callbacks keep one identity across renders, as the real store's do.
const refresh = { instances: () => fixture.refreshInstances(), models: (id: string) => fixture.refreshModels(id) };
vi.mock("@/state/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/state/store")>()),
  useStore: () => ({
    state: { instances: fixture.instances, bots: [], modelVariantSessions: {}, config: {} },
    dispatch: fixture.dispatch,
    refreshInstances: refresh.instances,
    refreshModels: refresh.models,
  }),
}));

const { ModelPicker } = await import("./ModelPicker");
const { resetAiSwitch, requestAiSwitch } = await import("@/lib/ai-switch");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const available = { state: "available", version: "1.0.0", authenticated: true } as const;
const simpleApi = {
  instanceId: "guai-simple-api", driverKind: "openai-compat", displayName: "SimpleAPI", access: "api", snapshot: available,
  models: { default: "kr-pro", options: [
    { id: "kr-max", label: "Max" }, { id: "kr-pro", label: "Pro" }, { id: "kr-mini", label: "Mini" },
  ] },
} as unknown as InstanceInfo;
const busyBot = {
  id: "maus", threadId: "thread-1", name: "Maus", title: "", description: "", notifications: true, color: "green", unread: false,
  busy: true, modelSelection: { instanceId: "old-engine", model: "gpt-5.6" }, messages: [],
} as unknown as Bot;

let host: HTMLDivElement;
let root: Root;
const trigger = () => host.querySelector<HTMLButtonElement>('[data-tour="model"]')!;
const tierButton = (tier: string) => document.querySelector<HTMLButtonElement>(`[data-service-tier="${tier}"]`)!;
beforeEach(() => {
  api.mockReset();
  api.mockResolvedValue({ ok: true });
  fixture.dispatch = vi.fn();
  fixture.instances = [simpleApi];
  fixture.refreshInstances = () => Promise.resolve();
  fixture.refreshModels = () => Promise.resolve();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(createElement(ModelPicker, { bot: busyBot, threadId: "thread-1" })));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  resetAiSwitch();
});

describe("Switch AI with the service-tier picker", () => {
  it("stays closed during a turn until the matching Switch AI intent opens it", () => {
    expect(trigger().disabled).toBe(true);
    act(() => requestAiSwitch({ botId: "maus", threadId: "thread-1", turnId: "turn-1", place: "header" }));
    expect(trigger().disabled).toBe(false);
    expect(document.querySelectorAll("[data-service-tier]")).toHaveLength(3);
  });

  it("interrupts the exact busy turn when a different tier is picked, without writing a model early", async () => {
    act(() => requestAiSwitch({ botId: "maus", threadId: "thread-1", turnId: "turn-1", place: "header" }));
    await act(async () => tierButton("kr-max").click());
    expect(api).toHaveBeenCalledWith("/api/bots/maus/interrupt", {
      method: "POST", body: JSON.stringify({ threadId: "thread-1", turnId: "turn-1" }),
    });
    expect(vi.mocked(fixture.dispatch).mock.calls.filter(([action]) => (action as { type: string }).type === "setModel")).toEqual([]);
  });

  it("ignores a Switch AI intent scoped to the bot panel when this is the chat header", () => {
    act(() => requestAiSwitch({ botId: "maus", threadId: "thread-1", turnId: "turn-1", place: "panel" }));
    expect(trigger().disabled).toBe(true);
  });
});
