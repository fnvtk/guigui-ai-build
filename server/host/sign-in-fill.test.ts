import { describe, expect, it, vi } from "vitest";

import { ensureCardPage, ensureLoginFormPage, hasSavedLoginForCard, isNoLoginFieldsError, loginPageCandidates, runSavedLoginFill, shouldAutoFillSignInCard } from "./sign-in-fill.ts";

const card = { url: "https://xmfangchan.com/login", site: "xmfangchan.com" };
const place = { site: "xmfangchan.com", hosts: ["xmfangchan.com"], exactHost: false };

describe("hasSavedLoginForCard", () => {
  it("matches a saved login for the card site, and not another site", () => {
    expect(hasSavedLoginForCard([place], "xmfangchan.com")).toBe(true);
    expect(hasSavedLoginForCard([place], "www.xmfangchan.com")).toBe(true);
    expect(hasSavedLoginForCard([place], "example.com")).toBe(false);
    expect(hasSavedLoginForCard([], "xmfangchan.com")).toBe(false);
  });
});

describe("shouldAutoFillSignInCard", () => {
  it("retries once after a restart when a saved login exists and the card still waits", () => {
    expect(shouldAutoFillSignInCard(card, true)).toBe(true);
    expect(shouldAutoFillSignInCard({ ...card, stopped: false }, true)).toBe(true);
    expect(shouldAutoFillSignInCard({ ...card, fillAutoRetried: true }, true)).toBe(false);
    expect(shouldAutoFillSignInCard(card, false)).toBe(false);
    expect(shouldAutoFillSignInCard({ ...card, done: true }, true)).toBe(false);
    expect(shouldAutoFillSignInCard({ ...card, cancelled: true }, true)).toBe(false);
    expect(shouldAutoFillSignInCard({ ...card, superseded: true }, true)).toBe(false);
  });

  it("allows one more auto-fill when a prior attempt found no login fields, then blocks a tight loop", () => {
    const missed = { ...card, fillAutoRetried: true, error: "No login fields found on xmfangchan.com. Open its sign-in page." };
    expect(isNoLoginFieldsError(missed.error)).toBe(true);
    expect(shouldAutoFillSignInCard(missed, true)).toBe(true);
    expect(shouldAutoFillSignInCard({ ...missed, fillLoginPageTried: true }, true)).toBe(false);
    expect(shouldAutoFillSignInCard({ ...card, fillAutoRetried: true, error: "Another conversation is using this browser." }, true)).toBe(false);
  });
});

describe("runSavedLoginFill", () => {
  it("fills without a username and settles only when fill succeeds", async () => {
    const fill = vi.fn(async () => ({ ok: true, text: "Filled the saved login on xmfangchan.com." }));
    const result = await runSavedLoginFill({ card, hasSavedLogin: true, fill });
    expect(fill).toHaveBeenCalledOnce();
    expect(result).toEqual({ ok: true, status: 200, settle: true, text: "Filled the saved login on xmfangchan.com." });
  });

  it("keeps the card open when fill fails, and does not treat failure as done", async () => {
    const fill = vi.fn(async () => ({ ok: false, text: "No login fields found on xmfangchan.com." }));
    const result = await runSavedLoginFill({ card, hasSavedLogin: true, fill });
    expect(result.ok).toBe(false);
    expect(result.settle).toBe(false);
    expect(result.status).toBe(200);
    expect(result.text).toContain("No login fields found");
  });

  it("refuses when no saved login exists, without calling fill", async () => {
    const fill = vi.fn(async () => ({ ok: true, text: "should not run" }));
    const result = await runSavedLoginFill({ card, hasSavedLogin: false, fill });
    expect(fill).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: false, status: 409, settle: false });
  });

  it("refuses an already-answered card without filling", async () => {
    const fill = vi.fn(async () => ({ ok: true, text: "should not run" }));
    expect((await runSavedLoginFill({ card: { ...card, done: true }, hasSavedLogin: true, fill })).status).toBe(409);
    expect(fill).not.toHaveBeenCalled();
  });
});

describe("ensureCardPage", () => {
  const url = "https://xmfangchan.com/login";

  it("leaves a page already on the card's site alone", async () => {
    const engine = vi.fn(async () => ({ url: "https://xmfangchan.com/account" }));
    const start = vi.fn(async () => true);
    await ensureCardPage({ engine, start, pageUrl: url });
    expect(engine).toHaveBeenCalledWith(["get", "url"]);
    expect(engine).not.toHaveBeenCalledWith(["open", url]);
    expect(start).not.toHaveBeenCalled();
  });

  it("starts a stopped browser and opens the card url", async () => {
    const engine = vi.fn(async (args: string[]) => args[0] === "get" ? null : { url });
    const start = vi.fn(async () => true);
    await ensureCardPage({ engine, start, pageUrl: url });
    expect(start).toHaveBeenCalledOnce();
    expect(engine).toHaveBeenCalledWith(["open", url]);
  });

  it("opens the card url when the current page is blank or another host", async () => {
    const engine = vi.fn(async (args: string[]) => args[0] === "get" ? { url: "about:blank" } : { url });
    await ensureCardPage({ engine, pageUrl: url });
    expect(engine).toHaveBeenCalledWith(["open", url]);
  });

  it("throws when the browser cannot be started or opened, so the card can stay open", async () => {
    const engine = vi.fn(async () => null);
    await expect(ensureCardPage({ engine, start: async () => false, pageUrl: url })).rejects.toThrow(/not available/);
    await expect(ensureCardPage({ engine, pageUrl: url })).rejects.toThrow(/not available/);
  });
});

describe("loginPageCandidates", () => {
  const home = "https://xmfangchan.com/";

  it("prefers a saved or discovered login URL over the public homepage, and does not invent a username", () => {
    expect(loginPageCandidates({
      currentUrl: home,
      savedUrls: ["https://xmfangchan.com/dashboard/login"],
      knownPaths: [],
    })).toEqual(["https://xmfangchan.com/dashboard/login"]);
    const found = loginPageCandidates({
      currentUrl: home,
      discoveredUrls: ["https://xmfangchan.com/dashboard/login"],
      knownPaths: [],
    });
    expect(found).toEqual(["https://xmfangchan.com/dashboard/login"]);
    expect(loginPageCandidates({ currentUrl: home }).some((url) => url.endsWith("/dashboard/login"))).toBe(true);
    expect(loginPageCandidates({ currentUrl: home, savedUrls: ["https://evil.example/login"], knownPaths: [] })).toEqual([]);
  });

  it("skips the current URL and the site root", () => {
    const urls = loginPageCandidates({ currentUrl: "https://xmfangchan.com/dashboard/login", savedUrls: ["https://xmfangchan.com/", "https://xmfangchan.com/dashboard/login"] });
    expect(urls).not.toContain("https://xmfangchan.com/dashboard/login");
    expect(urls.every((url) => !url.endsWith("xmfangchan.com/"))).toBe(true);
  });
});

describe("ensureLoginFormPage", () => {
  const home = "https://xmfangchan.com/";
  const login = "https://xmfangchan.com/dashboard/login";

  it("opens the login page when the homepage has no login fields, then is ready to fill", async () => {
    const opened: string[] = [];
    let fields = false;
    const engine = vi.fn(async (args: string[]) => {
      if (args[0] === "get") return { url: opened.at(-1) ?? "about:blank" };
      if (args[0] === "open") { opened.push(args[1]!); fields = args[1] === login; return { url: args[1] }; }
      return null;
    });
    const result = await ensureLoginFormPage({
      engine,
      pageUrl: home,
      savedUrls: [login],
      probe: async () => ({ hasFields: fields, loginUrls: [], url: opened.at(-1) ?? home }),
      wait: async () => {},
    });
    expect(opened).toEqual([home, login]);
    expect(result).toEqual({ opened: login, navigated: true });
  });

  it("leaves the form alone when login fields are already on the page", async () => {
    const engine = vi.fn(async (args: string[]) => args[0] === "get" ? { url: login } : { url: login });
    const result = await ensureLoginFormPage({
      engine,
      pageUrl: login,
      probe: async () => ({ hasFields: true, loginUrls: [], url: login }),
    });
    expect(result).toEqual({ opened: login, navigated: false });
    expect(engine).not.toHaveBeenCalledWith(["open", expect.anything()]);
  });

  it("throws a clear error when fields are still missing after navigation, so the card can stay open", async () => {
    const engine = vi.fn(async (args: string[]) => {
      if (args[0] === "get") return { url: home };
      if (args[0] === "open") return { url: args[1] };
      return null;
    });
    await expect(ensureLoginFormPage({
      engine,
      pageUrl: home,
      savedUrls: [login],
      probe: async () => ({ hasFields: false, loginUrls: [], url: home }),
      wait: async () => {},
      now: (() => { let n = 0; return () => (n += 10_000); })(),
      waitMs: 1,
    })).rejects.toThrow(/no login fields appeared/i);
  });
});
