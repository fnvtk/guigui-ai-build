// Which of a person's AIs a new bot uses, and which one the welcome offers first: SimpleAPI, then Claude, a ChatGPT
// plan, Gemini, Grok, and every other AI in the order the app lists them. OpenCode's free no-login model comes last.

export interface RankableAi {
  driverKind: string;
  displayName?: string;
  snapshot?: { freeFallback?: boolean };
}

/** What a test message through an AI showed: `untestable` is an AI with no one-off call to send one, trusted as before. */
export type AiTestState = "testing" | "passed" | "failed" | "untestable";

const TIERS: Readonly<Record<string, number>> = {
  claudeAgent: 0,
  codex: 1,
  geminiAgent: 2,
  antigravityAgent: 2,
  grokAgent: 3,
  grok: 3,
};
const SIMPLE_API = 0;
const OTHER = 5;
const FREE_FALLBACK = 6;

/** Ready only through OpenCode's free models: no login, no subscription, no key of the person's own. */
export function freeFallback(instance: RankableAi): boolean {
  return instance.snapshot?.freeFallback === true;
}

export function isSimpleApi(instance: Pick<RankableAi, "driverKind" | "displayName">): boolean {
  return instance.driverKind === "openai-compat" && instance.displayName?.replace(/\s+/g, "").toLowerCase() === "simpleapi";
}

function tier(instance: RankableAi): number {
  if (freeFallback(instance)) return FREE_FALLBACK;
  if (isSimpleApi(instance)) return SIMPLE_API;
  const existing = TIERS[instance.driverKind];
  return existing === undefined ? OTHER : existing + 1;
}

/** A new list, best first; AIs of one kind keep the order they came in. */
export function rankAis<T extends RankableAi>(instances: readonly T[]): T[] {
  return instances.map((instance, index) => ({ instance, index, tier: tier(instance) }))
    .sort((a, b) => a.tier - b.tier || a.index - b.index)
    .map(({ instance }) => instance);
}

interface SignInSnapshot {
  state: string;
  authenticated?: boolean;
  account?: { email?: string; organization?: string; method?: string };
  chatgptPlan?: boolean;
  freeFallback?: boolean;
}

/** Who an AI is signed in as: a test result holds until this changes. */
export function aiSignInKey(snapshot: SignInSnapshot): string {
  return JSON.stringify([
    snapshot.state, snapshot.authenticated ?? null, snapshot.account?.email ?? null, snapshot.account?.organization ?? null,
    snapshot.account?.method ?? null, snapshot.chatgptPlan === true, snapshot.freeFallback === true,
  ]);
}
