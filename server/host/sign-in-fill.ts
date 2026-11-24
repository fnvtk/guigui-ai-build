// Person-triggered or restart auto-retry fill of a sign-in card from a saved login.
// The server fills in the in-app browser; secrets never enter the model, the chat, or the card API response.
import { loginMatchesHost, loginOriginCheck, loginSite, type LoginPlace } from "../../shared/logins.ts";
import { signInWaits } from "../../shared/sign-in-request.ts";

export type SignInFillCard = {
  url: string;
  site: string;
  done?: unknown;
  cancelled?: unknown;
  superseded?: unknown;
  answeredInChat?: unknown;
  stopped?: unknown;
  fillAutoRetried?: unknown;
  fillLoginPageTried?: unknown;
  error?: unknown;
};

/** Whether any saved login may be filled on this card's site (or the page host). Never invents a username. */
export function hasSavedLoginForCard(places: ReadonlyArray<LoginPlace>, siteOrHost: string): boolean {
  return places.some((place) => loginMatchesHost(place, siteOrHost));
}

export function isNoLoginFieldsError(error: unknown): boolean {
  return typeof error === "string" && /no login fields found/i.test(error);
}

/** After a restart, auto-fill once when a saved login exists and the card still waits.
 *  A prior attempt that landed on a page without login fields may retry once so the
 *  in-app browser can open the site's real sign-in page; fillLoginPageTried blocks a tight loop. */
export function shouldAutoFillSignInCard(card: SignInFillCard, hasSavedLogin: boolean): boolean {
  if (!hasSavedLogin || !signInWaits(card)) return false;
  if (card.fillLoginPageTried === true) return false;
  if (card.fillAutoRetried !== true) return true;
  return isNoLoginFieldsError(card.error);
}

export type SavedLoginFillResult =
  | { ok: true; text: string; settle: true; status: 200 }
  | { ok: false; text: string; settle: false; status: 200 | 409 };

/** Run fill_login for a card without a username (the saved login is chosen on the server). Failure stays open. */
export async function runSavedLoginFill(input: {
  card: SignInFillCard;
  hasSavedLogin: boolean;
  fill: () => Promise<{ ok: boolean; text: string }>;
}): Promise<SavedLoginFillResult> {
  if (!signInWaits(input.card)) {
    return { ok: false, status: 409, settle: false, text: "this sign-in request was already answered" };
  }
  if (!input.hasSavedLogin) {
    return { ok: false, status: 409, settle: false, text: "No saved login for this site. Sign in on the page, or save a login, then try again." };
  }
  const outcome = await input.fill();
  if (outcome.ok) return { ok: true, status: 200, settle: true, text: outcome.text };
  return { ok: false, status: 200, settle: false, text: outcome.text };
}


/** Open the card's sign-in page in the in-app browser when no fillable page for that site is showing. */
export async function ensureCardPage(input: {
  engine: (args: string[]) => Promise<Record<string, unknown> | null>;
  start?: () => Promise<boolean>;
  pageUrl: string;
}): Promise<void> {
  let host = "";
  try { host = new URL(input.pageUrl).hostname; }
  catch { throw new Error("this sign-in request has no page address to open"); }
  const page = await input.engine(["get", "url"]);
  const current = typeof page?.url === "string" ? page.url : "";
  const place = { site: loginSite(host), hosts: [] as string[], exactHost: false };
  if (current && current !== "about:blank" && loginOriginCheck(current, place).ok) return;
  if (page == null && input.start) {
    const started = await input.start();
    if (!started) throw new Error("The browser is not available on this computer right now.");
  }
  const opened = await input.engine(["open", input.pageUrl]);
  if (opened == null) throw new Error("The browser is not available on this computer right now.");
}


/** Common same-origin paths to try when the current page has no login fields and no saved or on-page login URL. */
export const KNOWN_LOGIN_PATHS = [
  "/login",
  "/signin",
  "/sign-in",
  "/account/login",
  "/user/login",
  "/auth/login",
  "/dashboard/login",
  "/admin/login",
] as const;

const LOGIN_PATH = /\/(login|signin|sign-in|sign_in|auth|passport|sso|account\/login|dashboard\/login|admin\/login|user\/login)(?:\/|$|\?|#)/i;

export function isLoginLikeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return LOGIN_PATH.test(`${parsed.pathname}${parsed.search}${parsed.hash}`) || LOGIN_PATH.test(parsed.href);
  } catch {
    return false;
  }
}

export function sameSiteHttpUrl(candidate: string, siteOrUrl: string): boolean {
  try {
    const page = new URL(candidate);
    if (page.protocol !== "https:" && page.protocol !== "http:") return false;
    const base = /:\/\//.test(siteOrUrl) ? new URL(siteOrUrl) : new URL(`https://${siteOrUrl}/`);
    return loginSite(page.hostname) === loginSite(base.hostname);
  } catch {
    return false;
  }
}

function pathOf(url: string): string {
  try { return new URL(url).pathname.replace(/\/+$/u, "") || "/"; }
  catch { return ""; }
}

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

/** Unique same-site sign-in URLs to try, in order: saved login URLs, links found on the page, then known paths. */
export function loginPageCandidates(input: {
  currentUrl: string;
  savedUrls?: readonly string[];
  discoveredUrls?: readonly string[];
  knownPaths?: readonly string[];
}): string[] {
  let origin = "";
  try { origin = new URL(input.currentUrl).origin; }
  catch { return []; }
  const current = normalizeUrl(input.currentUrl);
  const currentPath = pathOf(input.currentUrl);
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string, requireLoginLike = false) => {
    if (!sameSiteHttpUrl(raw, input.currentUrl)) return;
    const url = normalizeUrl(raw);
    if (!url || url === current || seen.has(url)) return;
    if (requireLoginLike && !isLoginLikeUrl(url)) return;
    if (pathOf(url) === "/") return;
    seen.add(url);
    out.push(url);
  };
  for (const url of input.savedUrls ?? []) add(url, true);
  for (const url of input.savedUrls ?? []) add(url, false);
  for (const url of input.discoveredUrls ?? []) add(url, false);
  const paths = input.knownPaths ?? KNOWN_LOGIN_PATHS;
  for (const path of paths) {
    if (pathOf(`${origin}${path}`) === currentPath) continue;
    try { add(new URL(path, `${origin}/`).toString(), false); }
    catch { /* ignore bad path */ }
  }
  return out;
}

export type LoginFormProbe = {
  hasFields: boolean;
  loginUrls: string[];
  url: string;
};

export function readLoginFormProbe(data: Record<string, unknown> | null): LoginFormProbe | null {
  let value: unknown = data?.result ?? data;
  for (let depth = 0; depth < 2 && typeof value === "string"; depth++) {
    try { value = JSON.parse(value); } catch { return null; }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const url = typeof row.url === "string" ? row.url : typeof row.href === "string" ? row.href : "";
  const loginUrls = Array.isArray(row.loginUrls) ? row.loginUrls.filter((item): item is string => typeof item === "string") : [];
  return { hasFields: row.hasFields === true, loginUrls, url };
}

/** In-page probe: whether a login form is showing, and sign-in links on the page. Never reads field values. */
export const LOGIN_FORM_PROBE_SCRIPT = `(() => {
  const visible = (el) => {
    if (!(el instanceof Element) || !el.isConnected || el.getClientRects().length === 0) return false;
    for (let node = el; node instanceof Element; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || style.opacity === "0") return false;
    }
    return true;
  };
  const usable = (el) => el instanceof HTMLInputElement && visible(el) && !el.disabled && el.type !== "hidden" && el.type !== "submit" && el.type !== "button" && el.type !== "checkbox" && el.type !== "radio";
  const inputs = Array.from(document.querySelectorAll("input")).filter(usable);
  const hint = (el) => [el.name, el.id, el.placeholder, el.getAttribute("aria-label"), el.autocomplete].filter(Boolean).join(" ").toLowerCase();
  const hasPassword = inputs.some((el) => el.type === "password");
  const hasUser = inputs.some((el) => el.type === "email" || el.type === "tel" || /user|e-?mail|phone|mobile|account|login|name|手机|帳號|账号|用户/.test(hint(el)));
  const hasFields = hasPassword || hasUser;
  const labeled = /log\\s*in|sign\\s*in|登录|登陸|登入|signin|sign-in/i;
  const pathish = /\\/(login|signin|sign-in|sign_in|auth|passport|sso|account\\/login|dashboard\\/login|admin\\/login|user\\/login)(?:\\/|$|\\?|#)/i;
  const loginUrls = [];
  for (const a of document.querySelectorAll("a[href]")) {
    const href = a.href;
    const text = [a.innerText, a.getAttribute("aria-label"), a.getAttribute("title")].filter(Boolean).join(" ");
    if (href && (labeled.test(text) || pathish.test(href))) loginUrls.push(href);
  }
  return JSON.stringify({ href: location.href, hasFields, loginUrls });
})()`;

export async function probeLoginForm(engine: (args: string[]) => Promise<Record<string, unknown> | null>): Promise<LoginFormProbe | null> {
  const page = await engine(["get", "url"]);
  const current = typeof page?.url === "string" ? page.url : "";
  try {
    const probed = readLoginFormProbe(await engine(["eval", LOGIN_FORM_PROBE_SCRIPT]));
    if (probed) return { ...probed, url: probed.url || current };
  } catch {
    // A page that refuses eval is treated as having no fields; the caller may still open a known login URL.
  }
  return current ? { hasFields: false, loginUrls: [], url: current } : null;
}

/** Open the card's page, and if it has no login fields, open the site's real sign-in page and wait for the form. */
export async function ensureLoginFormPage(input: {
  engine: (args: string[]) => Promise<Record<string, unknown> | null>;
  start?: () => Promise<boolean>;
  pageUrl: string;
  savedUrls?: readonly string[];
  probe?: () => Promise<LoginFormProbe | null>;
  wait?: (ms: number) => Promise<void>;
  now?: () => number;
  waitMs?: number;
}): Promise<{ opened: string; navigated: boolean }> {
  await ensureCardPage({ engine: input.engine, start: input.start, pageUrl: input.pageUrl });
  const probe = input.probe ?? (() => probeLoginForm(input.engine));
  const wait = input.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = input.now ?? Date.now;
  const waitMs = input.waitMs ?? 8_000;
  const first = await probe();
  if (first?.hasFields) return { opened: first.url || input.pageUrl, navigated: false };
  const currentUrl = first?.url || (await input.engine(["get", "url"]))?.url as string | undefined || input.pageUrl;
  const candidates = loginPageCandidates({
    currentUrl: typeof currentUrl === "string" && currentUrl ? currentUrl : input.pageUrl,
    savedUrls: input.savedUrls,
    discoveredUrls: first?.loginUrls,
  });
  if (!candidates.length) {
    throw new Error("No login fields on this page, and no sign-in page was found for this site. Open the page with the username, password or code box, then try again.");
  }
  for (const url of candidates) {
    const opened = await input.engine(["open", url]);
    if (opened == null) continue;
    const deadline = now() + waitMs;
    while (now() <= deadline) {
      const state = await probe();
      if (state?.hasFields) return { opened: state.url || url, navigated: true };
      if (now() + 250 <= deadline) await wait(250);
      else break;
    }
  }
  throw new Error("Opened a sign-in page for this site, but no login fields appeared. The card stays open so you can open the real login form and try again.");
}
