import { describe, expect, it, vi } from "vitest";

import type { Surface } from "../../shared/wire.ts";
import type { BotRecord } from "../store.ts";
import { createFillLoginTurn, type FillLoginTurnDeps } from "./fill-login-turn.ts";

const turn = { botId: "b1", threadId: "t1", generation: "g1" };
const bot = { id: "b1", name: "Statements", browser: true, browserProfile: "bank" } as unknown as BotRecord;
const BANK = { site: "bank.test", hosts: ["bank.test"], exactHost: false, username: "person@example.test" };

function harness(over: Partial<FillLoginTurnDeps> & { at?: Surface | null } = {}) {
  const moveToBrowser = vi.fn(over.moveToBrowser ?? (() => true));
  const target = vi.fn(over.target ?? (async () => null));
  const deps: FillLoginTurnDeps = {
    place: () => (over.at === undefined ? "local" : over.at),
    current: (b) => b,
    builtInBrowserOn: () => true,
    browserSelectable: () => true,
    myChrome: () => false,
    claim: () => true,
    withSecretInput: (_session, _spec, fill) => fill(),
    logins: { sitesFor: () => [BANK], candidates: async () => [], markUsed: () => {} },
    onePasswordTrouble: () => undefined,
    loginInput: () => ({ engine: async () => null, insertText: async () => {}, press: async () => {}, click: async () => {} }),
    remember: () => {},
    stepContext: () => ({ botId: "b1", botName: "Statements", threadId: "t1", generation: "g1", turnId: () => null, record: false }),
    ...over,
    moveToBrowser,
    target,
  };
  const created = createFillLoginTurn(deps);
  return { fill: created.fillLoginForTurn, fillLoginForCard: created.fillLoginForCard, moveToBrowser, target, deps };
}

describe("fill_login outside the bot's own browser", () => {
  it.each(["local", "vm", "cloud"] as const)("moves a request on %s to the bot's browser and tells the bot to end the turn", async (at) => {
    const { fill, moveToBrowser, target } = harness({ at });
    const answer = await fill(bot, turn, undefined, undefined);
    expect(target).toHaveBeenCalledOnce();
    expect(moveToBrowser).toHaveBeenCalledWith(turn);
    expect(answer.ok).toBe(false);
    expect(answer.text).toContain("never types one on the screen of");
    expect(answer.text).toContain("moving this conversation to your own browser");
    expect(answer.text).toContain("End this turn now");
    expect(answer.text).not.toContain("request_sign_in");
  });

  it("names the person's own Chrome when the bot's profile is My Chrome", async () => {
    const { fill } = harness({ myChrome: () => true });
    expect((await fill(bot, turn, undefined, undefined)).text).toContain("the person's own Chrome (My Chrome)");
  });

  it("asks for a sign-in on the screen when this run cannot move and the in-app browser cannot be targeted, without moving it", async () => {
    const { fill, moveToBrowser, target } = harness({ moveToBrowser: () => false });
    const answer = await fill(bot, turn, undefined, undefined);
    expect(target).toHaveBeenCalledOnce();
    expect(moveToBrowser).toHaveBeenCalledOnce();
    expect(answer.text).toContain("this run cannot move to your browser");
    expect(answer.text).toContain("Call request_sign_in so the person signs in on this computer.");
  });

  const targetable = {
    target: async () => ({ session: "bot-b1", spec: { command: "agent-browser", env: {} }, env: {} }),
    loginInput: () => ({ engine: async () => ({ url: "https://bank.test/sign-in" }), insertText: async () => {}, press: async () => {}, click: async () => {} }),
  };

  it("fills in the in-app browser in the same turn even when this run cannot switch the conversation's place", async () => {
    const { fill, moveToBrowser, target } = harness({ at: "local", moveToBrowser: () => false, ...targetable });
    const answer = await fill(bot, turn, undefined, undefined);
    expect(target).toHaveBeenCalledOnce();
    expect(moveToBrowser).toHaveBeenCalledWith(turn);
    expect(answer.text).toContain("No saved login for bank.test.");
    expect(answer.text).not.toContain("this run cannot move to your browser");
    expect(answer.text).not.toContain("Call request_sign_in so the person signs in on this computer.");
  });

  it("fills in the in-app browser now instead of ending the turn when the browser can be targeted", async () => {
    const { fill, target } = harness({ at: "local", ...targetable });
    const answer = await fill(bot, turn, undefined, undefined);
    expect(target).toHaveBeenCalledOnce();
    expect(answer.text).toContain("No saved login for bank.test.");
    expect(answer.text).not.toContain("End this turn now");
  });

  it("never moves when the bot has no login to fill, and says 1Password could not be read", async () => {
    const { fill, moveToBrowser } = harness({
      logins: { sitesFor: () => [], candidates: async () => [], markUsed: () => {} },
      onePasswordTrouble: () => "Could not reach 1Password. Check the internet connection and try again.",
    });
    const answer = await fill(bot, turn, undefined, undefined);
    expect(moveToBrowser).not.toHaveBeenCalled();
    expect(answer.text).toBe("You have no saved logins to fill (1Password could not be read just now: Could not reach 1Password. Check the internet connection and try again.). Call request_sign_in so the person signs in on this computer.");
  });

  it("never moves when the bot's browser cannot be its place, and says why", async () => {
    const off = harness({ browserSelectable: () => false, builtInBrowserOn: () => false });
    const answer = await off.fill(bot, turn, undefined, undefined);
    expect(off.moveToBrowser).not.toHaveBeenCalled();
    expect(answer.text).toContain("the built-in browser is off for you here");
    const missing = harness({ browserSelectable: () => false });
    expect((await missing.fill(bot, turn, undefined, undefined)).text).toContain("it is not installed yet, or this AI model cannot use browser tools");
    expect(missing.moveToBrowser).not.toHaveBeenCalled();
  });

  it("keeps the plain answer for a conversation with no place at all", async () => {
    const { fill } = harness({ at: null, browserSelectable: () => false });
    expect(await fill(bot, turn, undefined, undefined)).toEqual({ ok: false, text: "fill_login works in the built-in browser, and this conversation has none. Call request_sign_in instead." });
  });
});

describe("fill_login in the bot's own browser", () => {
  it("fills there and never asks to move", async () => {
    const { fill, moveToBrowser, target } = harness({ at: "browser" });
    const answer = await fill(bot, turn, undefined, undefined);
    expect(moveToBrowser).not.toHaveBeenCalled();
    expect(target).toHaveBeenCalledOnce();
    expect(answer).toEqual({ ok: false, text: "The browser is not available on this computer right now. Call request_sign_in instead." });
  });

  it("says 1Password could not be read when no login matches the page", async () => {
    const { fill } = harness({
      at: "browser",
      target: async () => ({ session: "bot-b1", spec: { command: "agent-browser", env: {} }, env: {} }),
      loginInput: () => ({ engine: async () => ({ url: "https://bank.test/sign-in" }), insertText: async () => {}, press: async () => {}, click: async () => {} }),
      onePasswordTrouble: () => "1Password is limiting requests right now. Try again in a few minutes.",
    });
    const answer = await fill(bot, turn, undefined, undefined);
    expect(answer.ok).toBe(false);
    expect(answer.text).toContain("No saved login for bank.test.");
    expect(answer.text).toContain("1Password could not be read just now, so its logins may be missing: 1Password is limiting requests right now.");
  });
});

describe("fillLoginForCard", () => {
  const pageUrl = "https://bank.test/sign-in";
  const targetable = {
    target: async () => ({ session: "bot-b1", spec: { command: "agent-browser", env: {} }, env: {} }),
    loginInput: () => ({ engine: async () => ({ url: pageUrl }), insertText: async () => {}, press: async () => {}, click: async () => {} }),
  };

  it("opens the card page and fills without a username", async () => {
    const ensurePage = vi.fn(async () => {});
    const { fillLoginForCard, target } = harness({ at: "local", ensurePage, ...targetable });
    const answer = await fillLoginForCard(bot, "t1", "card-1", pageUrl);
    expect(target).toHaveBeenCalled();
    expect(ensurePage).toHaveBeenCalledOnce();
    expect(ensurePage).toHaveBeenCalledWith(expect.anything(), pageUrl);
    expect(answer.ok).toBe(false);
    expect(answer.text).toContain("No saved login for bank.test.");
    expect(answer.text).not.toContain("Call request_sign_in so the person signs in on this computer.");
  });

  it("keeps the failure when the page cannot be opened, and does not treat it as done", async () => {
    const { fillLoginForCard } = harness({
      ...targetable,
      ensurePage: async () => { throw new Error("The browser is not available on this computer right now."); },
    });
    const answer = await fillLoginForCard(bot, "t1", "card-1", pageUrl);
    expect(answer).toEqual({ ok: false, text: expect.stringContaining("Could not open the sign-in page") } as unknown as { ok: boolean; text: string });
    expect(answer.ok).toBe(false);
    expect(answer.text).toContain("Could not open the sign-in page");
    expect(answer.text).toContain("The browser is not available");
  });

  it("does not invent a username when no one is passed", async () => {
    const withSecretInput = vi.fn(async (_s, _spec, fill) => fill());
    const { fillLoginForCard } = harness({ at: "browser", ...targetable, withSecretInput, ensurePage: async () => {} });
    await fillLoginForCard(bot, "t1", "card-1", pageUrl);
    expect(withSecretInput).toHaveBeenCalledOnce();
  });
});
