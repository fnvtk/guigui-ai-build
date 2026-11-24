/** Login and credential steps stay in place: the server fills saved logins, and
 *  a missing login keeps the in-app sign-in card open. Secrets never go through
 *  the model's chat text. */
export const LOGIN_STAY_GUIDANCE =
  " Stay on this sign-in page and handle the login there. If a saved login exists for this site, call fill_login so the server fills it — retry fill_login first and stay on this step; do not invent a username such as \"admin\", and do not only wait for a person. The open card can also fill the saved login (the person need not paste it into the chat). never paste a password into the chat. If none is saved, call request_sign_in and wait for in-app input on the sign-in card. Do not end or leave this unfinished login.";

export type LoginNextAction = "done" | "retry_fill_login" | "keep_sign_in_open";

export function loginFailureShouldStay(outcomeText: string): boolean {
  return /no saved login|you have no saved logins|could not fill the login|call request_sign_in|call fill_login|not a web page fill_login|not secure \(http|another conversation is using this browser|person is using this browser|built-in browser is off|browser is not available|no page open/i.test(outcomeText);
}

export function loginNextAction(input: {
  fillOk?: boolean;
  hasSavedLoginForHost?: boolean;
  fillOutcomeText?: string;
}): LoginNextAction {
  if (input.fillOk) return "done";
  if (input.hasSavedLoginForHost) return "retry_fill_login";
  return "keep_sign_in_open";
}

export function withLoginStayGuidance(text: string): string {
  if (!text) return LOGIN_STAY_GUIDANCE.trim();
  if (text.includes("Do not end or leave this unfinished login")) return text;
  return `${text.replace(/\s+$/u, "")}${LOGIN_STAY_GUIDANCE}`;
}
