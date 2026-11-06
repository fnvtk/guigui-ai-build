import { createElement, type EffectCallback } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({ effects: [] as EffectCallback[], state: { cloudHowTo: true }, dispatch: vi.fn() }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useEffect: (effect: EffectCallback) => { f.effects.push(effect); },
}));
vi.mock("@/state/store", () => ({ useStore: () => ({ state: f.state, dispatch: f.dispatch }) }));
import { CloudHowTo } from "./CloudHowTo";

beforeEach(() => { vi.clearAllMocks(); f.effects = []; f.state = { cloudHowTo: true }; });
afterEach(() => vi.unstubAllGlobals());

it("dismisses the retired Add a Cloud tutorial without showing a purchase or help prompt", () => {
  expect(renderToStaticMarkup(createElement(CloudHowTo))).toBe("");
  f.effects.forEach(effect => effect());
  expect(f.dispatch).toHaveBeenCalledWith({ type: "cloudHowTo", open: false });
});
