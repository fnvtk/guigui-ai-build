// Why a chat-engine turn (openai-chat.ts) stopped on a tool call that failed or was not allowed: which calls, so the
// person, a routine's run log and a Chief read the cause. The calls' own output stays in their steps: a tool's error text
// ("403", "quota exceeded") must not read as the engine's own sign-in or usage limit to the failure classifiers.
const SHOWN = 3;
const NAME_CHARS = 80;

const quoted = (name: string) => `“${name.length > NAME_CHARS ? `${name.slice(0, NAME_CHARS - 1)}…` : name}”`;

function recoveryHint(name: string): string | undefined {
  if (/select_computer|computer/i.test(name)) {
    return "For a computer failure, call select_computer with no arguments to inspect the available choices. If none are available, open the Screen panel, configure or reconnect a computer, then retry the original request.";
  }
  if (/coordinate_bots|delegate_bot|ask_bot|start_thread|post_to_room/i.test(name)) {
    return "For a teammate hand-off failure, call list_bots or list_room_targets, copy an exact reachable id, and retry only after checking that no assignment was already created.";
  }
  if (/show_html|update_html|agents_show_html/i.test(name)) {
    return "For a page failure, call show_html with html, jsx or path to create a new page. Only replace a page after a successful show_html returns its app id; do not call update_html without that id.";
  }
  if (/browser.*click/i.test(name)) {
    return "For a browser click failure, reread the current page or snapshot, confirm the target still exists, then retry only that click once. Do not repeat a write until its outcome is checked.";
  }
  if (/browser|page/i.test(name)) {
    return "For a browser timeout, treat the page result as unverified: wait for the current request to settle, refresh or read the current page once, and retry only the failed read/action. Do not repeat a write until its outcome is checked.";
  }
  return undefined;
}

function list(names: readonly string[]): string {
  const shown = names.slice(0, SHOWN).map(quoted);
  const more = names.length - shown.length;
  if (more > 0) return `${shown.join(", ")} and ${more} more`;
  return shown.length > 1 ? `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}` : shown[0] ?? "";
}

/** `failed`: the calls whose result was a failure, in order, refused ones included; `refused`: the ones not allowed. */
export function toolFailureMessage(failed: readonly string[], refused: readonly string[]): string {
  const notAllowed = [...new Set(refused)];
  const broke = [...new Set(failed)].filter((name) => !notAllowed.includes(name));
  const calls = (names: readonly string[]) => `${names.length === 1 ? "the tool call" : "the tool calls"} ${list(names)}`;
  const wasnt = notAllowed.length === 1 ? "wasn't allowed" : "weren't allowed";
  const why = broke.length && notAllowed.length ? `${calls(broke)} failed and ${list(notAllowed)} ${wasnt}`
    : broke.length ? `${calls(broke)} failed`
    : notAllowed.length ? `${calls(notAllowed)} ${wasnt}`
    : "a tool call failed";
  const after = broke.length || !notAllowed.length ? "the failed step shows the error" : "that step didn't run";
  const base = `Stopped because ${why}. The bot's reply isn't proof the work was done; ${after}.`;
  const hints = [...new Set([...broke, ...notAllowed].map(recoveryHint).filter((hint): hint is string => Boolean(hint)))];
  return hints.length ? `${base} ${hints.join(" ")}` : base;
}
