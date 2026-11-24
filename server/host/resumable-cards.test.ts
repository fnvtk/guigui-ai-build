import { describe, expect, it } from "vitest";

import { cardsToParkAfterTurn, resumableCards, stoppedSignInCardIdsToRevive } from "./resumable-cards.ts";

describe("cardsToParkAfterTurn", () => {
  const signin = { id: "s1", waits: "sign in to example.com", kind: "signin" as const };
  const secret = { id: "c1", waits: "provide key", kind: "secret" as const };

  it("parks every open card when the turn did not stall", () => {
    expect(cardsToParkAfterTurn([signin, secret], false)).toEqual({ park: [signin, secret], stopIds: [] });
  });

  it("keeps sign-in cards parked on a stall and stops other kinds", () => {
    expect(cardsToParkAfterTurn([signin, secret], true)).toEqual({ park: [signin], stopIds: ["c1"] });
    expect(cardsToParkAfterTurn([secret], true)).toEqual({ park: [], stopIds: ["c1"] });
  });
});

describe("stoppedSignInCardIdsToRevive", () => {
  it("reopens a stopped card that still has no result, and leaves finished or cancelled cards alone", () => {
    expect(stoppedSignInCardIdsToRevive([
      { id: "open", kind: "signin", signIn: { stopped: true } },
      { id: "done", kind: "signin", signIn: { stopped: true, done: true } },
      { id: "cancelled", kind: "signin", signIn: { stopped: true, cancelled: true } },
      { id: "live", kind: "signin", signIn: {} },
      { id: "secret", kind: "secret", signIn: { stopped: true } },
    ])).toEqual(["open"]);
  });
});

describe("resumableCards", () => {
  it("lists an unanswered sign-in even if a prior stall marked it stopped", () => {
    const cards = resumableCards({
      activePath: () => [{
        id: "s1", at: 10, kind: "signin", signIn: { site: "example.com", stopped: true },
      }],
    } as never, "t1", 0);
    expect(cards).toEqual([{ id: "s1", waits: "sign in to example.com", kind: "signin" }]);
  });
});
