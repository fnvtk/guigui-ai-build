import type { Store } from "../store.ts";
import { signInWaits } from "../../shared/sign-in-request.ts";

export type ResumableCardKind = "team-setup" | "connector" | "secret" | "signin";

export type ResumableCard = { id: string; waits: string; kind: ResumableCardKind };

/** The cards since `since` that a parked turn waits on, and what each waits for. In a room (`memberId`) only this
 * member's cards: one member's park never swallows another's. */
export function resumableCards(store: Pick<Store, "activePath">, threadId: string, since: number, memberId?: string): ResumableCard[] {
  const open: ResumableCard[] = [];
  const path = store.activePath(threadId).filter((message) => message.at >= since && (memberId === undefined || message.from?.botId === memberId));
  for (const message of path) {
    const card = message.card;
    if (card?.teamSetupRequest && !card.teamSetupRequest.resumed && (card.teamSetupRequest.result || (!card.answered && !card.dismissed && !card.expired))) {
      open.push({ id: message.id, waits: `team setup decision: ${card.title}`, kind: "team-setup" });
      continue;
    }
    const connector = message.connector;
    if (connector && !connector.dismissed && !connector.resumed) {
      open.push({ id: message.id, waits: `connect ${connector.label}`, kind: "connector" });
      continue;
    }
    const secret = message.secret;
    if (secret && !secret.resumed && !secret.superseded) {
      open.push({ id: message.id, waits: `provide ${secret.label}`, kind: "secret" });
      continue;
    }
    const signIn = message.signIn;
    // Include a completed card until the bot has resumed; include a stopped card that still has no result.
    if (signIn && !signIn.resumed && !signIn.superseded && !signIn.answeredInChat) {
      open.push({ id: message.id, waits: `sign in to ${signIn.site}`, kind: "signin" });
    }
  }
  return open;
}

/** On a stalled turn, keep waiting sign-in cards parked and fillable; stop other card kinds as before. */
export function cardsToParkAfterTurn<T extends { id: string; kind: ResumableCardKind }>(cards: readonly T[], stalled: boolean): { park: T[]; stopIds: string[] } {
  if (!stalled) return { park: [...cards], stopIds: [] };
  return {
    park: cards.filter((card) => card.kind === "signin"),
    stopIds: cards.filter((card) => card.kind !== "signin").map((card) => card.id),
  };
}

/** Waiting sign-in cards that a restart should reopen: stopped with no completed or cancelled result. */
export function stoppedSignInCardIdsToRevive(messages: ReadonlyArray<{ id: string; kind?: string; signIn?: { stopped?: unknown; resumed?: unknown; done?: unknown; cancelled?: unknown; superseded?: unknown; answeredInChat?: unknown } }>): string[] {
  const ids: string[] = [];
  for (const message of messages) {
    if (message.kind !== "signin" || !message.signIn) continue;
    if (message.signIn.stopped !== true || message.signIn.resumed === true) continue;
    if (!signInWaits(message.signIn)) continue;
    ids.push(message.id);
  }
  return ids;
}
