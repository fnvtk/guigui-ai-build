import { createElement, type EffectCallback, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CloudAccountState } from "../../electron/cloud-account.mjs";

const f = vi.hoisted(() => ({ values: [] as unknown[], index: 0, effects: [] as EffectCallback[], dispatch: null as any }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useState: (initial: unknown) => { const index = f.index++; if (!(index in f.values)) f.values[index] = typeof initial === "function" ? initial() : initial;
    return [f.values[index], (next: unknown) => { f.values[index] = next; }]; },
  useEffect: (effect: EffectCallback) => { f.effects.push(effect); },
}));
vi.mock("@/state/store", () => ({ useStore: () => ({ dispatch: f.dispatch }) }));
import { CloudPlanRow, ProSettingsCard } from "./ProIntroduction";

const signedOut = { status: "signed-out" } as const;
const active = { status: "connected", account: { id: "a", email: "person@example.test" },
  entitlement: { plan: "pro", tier: "pro", status: "active", expiresAt: 1_900_000_000_000, version: 2 } } as CloudAccountState;
let bridge: Record<string, ReturnType<typeof vi.fn>>;
beforeEach(() => {
  vi.clearAllMocks(); f.values = []; f.index = 0; f.effects = []; f.dispatch = vi.fn();
  bridge = { state: vi.fn(async () => signedOut), onState: vi.fn(() => () => {}), offer: vi.fn(async () => ({ plans: [] })) };
  vi.stubGlobal("window", { ogb: { cloudAccount: bridge } });
});
afterEach(() => vi.unstubAllGlobals());

const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
async function markup(Component: () => ReactNode, state: CloudAccountState) {
  f.values = []; bridge.state.mockResolvedValue(state);
  for (let round = 0; round < 3; round++) { f.index = 0; f.effects = []; renderToStaticMarkup(createElement(Component)); f.effects.forEach(effect => effect()); await flush(); }
  f.index = 0; f.effects = [];
  return renderToStaticMarkup(createElement(Component));
}
it("does not show Cloud purchase, trial, or upgrade prompts for a signed-out account", async () => {
  const html = await markup(ProSettingsCard, signedOut);
  expect(html).not.toMatch(/data-cloud-offer|Add a Cloud|free trial|upgrade|plans from/i);
  expect(bridge.offer).not.toHaveBeenCalled();
});

it("retains existing Cloud plan status and settings access without purchase prompts", async () => {
  const html = await markup(ProSettingsCard, active);
  expect(html).toContain('data-cloud-plan="paid"');
  expect(html).not.toMatch(/data-cloud-offer|Add a Cloud|free trial|upgrade|plans from/i);
  expect(html).toContain("MausBot Cloud settings");
  expect(bridge.offer).not.toHaveBeenCalled();
});

it("does not show an offer in the plan row", async () => {
  const row = () => createElement(CloudPlanRow, { place: "plan" });
  const html = await markup(row, signedOut);
  expect(html).not.toMatch(/data-cloud-offer|Add a Cloud|free trial|upgrade|plans from/i);
  expect(bridge.offer).not.toHaveBeenCalled();
});
