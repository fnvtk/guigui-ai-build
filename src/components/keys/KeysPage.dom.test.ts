// @vitest-environment happy-dom
import { createElement, Fragment } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";

const fx = vi.hoisted(() => ({
  config: {} as Record<string, unknown>,
  listeners: new Set<() => void>(),
  api: vi.fn(),
  dispatch: vi.fn(),
}));
vi.mock("@/state/store", async (original) => {
  const actual = await original<typeof import("@/state/store")>();
  const { useSyncExternalStore } = await import("react");
  const subscribe = (listener: () => void) => { fx.listeners.add(listener); return () => { fx.listeners.delete(listener); }; };
  return {
    ...actual,
    api: (...args: unknown[]) => fx.api(...args),
    useStore: () => {
      const config = useSyncExternalStore(subscribe, () => fx.config);
      return { state: { ...actual.initialState, config, instances: [] }, dispatch: fx.dispatch };
    },
  };
});
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/live-call-media", () => ({ dismissLiveNotice: vi.fn() }));

const { KeysPage } = await import("./KeysPage");
const { LiveKeyNeeded } = await import("../LiveKeyNeeded");
const { openKeySettings } = await import("./key-focus");

let host: HTMLDivElement;
let root: Root;

function setConfig(config: Record<string, unknown>) {
  fx.config = config;
  for (const listener of Array.from(fx.listeners)) listener();
}

const render = (...children: Array<() => ReturnType<typeof createElement>>) =>
  flushSync(() => root.render(createElement(Fragment, null, ...children.map((child) => child()))));
const page = () => render(() => createElement(KeysPage, { key: "page" }));
const row = (id: string) => host.querySelector<HTMLElement>(`[data-key-row="${id}"]`);
const rowsShown = () => [...host.querySelectorAll<HTMLElement>("[data-key-row]")].filter((element) => !element.closest("[hidden]")).map((element) => element.dataset.keyRow);
const section = (id: string) => host.querySelector<HTMLElement>(`[data-keys-section="${id}"]`)!;
const expanded = (id: string) => section(id).querySelector("button[aria-expanded]")!.getAttribute("aria-expanded");

function type(input: HTMLInputElement, value: string) {
  flushSync(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function paste(input: HTMLInputElement, text: string) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: { getData: () => text } });
  flushSync(() => input.dispatchEvent(event));
}

beforeEach(() => {
  setLocale("en");
  fx.api.mockReset();
  fx.dispatch.mockReset();
  fx.dispatch.mockImplementation((action: { type: string; config?: Record<string, unknown> }) => {
    if (action.type === "configStatus") setConfig(action.config!);
  });
  fx.config = { composio: { configured: false }, box: { configured: false }, vps: { configured: false, sshAlias: "" } };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
});

describe("the keys page", () => {
  it("shows the remaining key sections", () => {
    page();
    expect([...host.querySelectorAll<HTMLElement>("[data-keys-section]")].map((element) => element.dataset.keysSection))
      .toEqual(["ai", "servers", "voice", "computers", "apps", "helpers"]);
    expect(expanded("ai")).toBe("true");
    expect(expanded("servers")).toBe("false");
    expect(rowsShown()).toContain("openai");
    expect(rowsShown()).not.toContain("elevenlabs");
  });

  it("opens a section that holds a saved key, and counts what is connected", () => {
    setConfig({ ...fx.config, box: { configured: true, last4: "c3d4" } });
    page();
    expect(expanded("computers")).toBe("true");
    expect(section("computers").textContent).not.toContain("1 connected");
    expect(row("box")).toBeNull();
  });

  it("filters rows live by name, purpose and section, and says so when nothing matches", () => {
    page();
    const search = host.querySelector<HTMLInputElement>("[data-keys-search]")!;
    type(search, "fish");
    expect(rowsShown()).toEqual(["fishAudio"]);
    type(search, "Computers and browser");
    expect(rowsShown()).toEqual(["vps", "onePassword"]);
    type(search, "research");
    expect(rowsShown()).toEqual(["treg"]);
    type(search, "zzz");
    expect(rowsShown()).toEqual([]);
    expect(host.querySelector("[data-keys-empty]")!.textContent).toBe("No keys match “zzz”.");
  });

  it("lands the live-call notice's button on the OpenAI row in Voice and calls, focused and lit", async () => {
    render(() => createElement(LiveKeyNeeded, { key: "notice" }), () => createElement(KeysPage, { key: "page" }));
    expect(expanded("voice")).toBe("false");
    const button = [...host.querySelectorAll("button")].find((candidate) => candidate.textContent === "Open API keys")!;
    flushSync(() => button.click());
    expect(fx.dispatch).toHaveBeenCalledWith({ type: "toggleAppSettings", open: true, section: "connections" });
    const live = () => row("liveCalls")!.querySelector<HTMLInputElement>("[data-key-input]")!;
    await vi.waitFor(() => expect(document.activeElement).toBe(live()));
    expect(expanded("voice")).toBe("true");
    expect(row("liveCalls")!.hasAttribute("data-key-highlight")).toBe(true);
    expect(live().getAttribute("aria-label")).toBe("OpenAI API key");
    expect(row("liveCalls")!.textContent).toContain("Live calls use the same key as OpenAI's models");
  });

  it("clears a search that would hide the row a link asks for", async () => {
    page();
    type(host.querySelector<HTMLInputElement>("[data-keys-search]")!, "fish");
    flushSync(() => { openKeySettings("fishAudio"); });
    await vi.waitFor(() => expect(document.activeElement).toBe(row("fishAudio")!.querySelector("[data-key-input]")));
    expect(host.querySelector<HTMLInputElement>("[data-keys-search]")!.value).toBe("");
  });

  it("opens the SimpleAPI-compatible key row from the connection dialog", async () => {
    page();
    flushSync(() => { openKeySettings("openaiCompat"); });
    await vi.waitFor(() => expect(document.activeElement).toBe(row("openaiCompat")!.querySelector("[data-key-input], [data-key-open], input, button")));
    expect(expanded("servers")).toBe("true");
  });

  it("warns, and saves nothing, when a pasted key looks like another provider's", () => {
    page();
    const input = row("fishAudio")!.querySelector<HTMLInputElement>("[data-key-input]")!;
    paste(input, "  sk-ant-api03-abcdefghijklmnop\n");
    expect(row("fishAudio")!.textContent).toContain("That looks like the Anthropic API key, not this one.");
    expect(input.value).toBe("sk-ant-api03-abcdefghijklmnop");
    expect(fx.api).not.toHaveBeenCalled();
  });

  it("saves a pasted key and reads it back masked", async () => {
    fx.api.mockImplementation(async (path: string) => path === "/api/config"
      ? { ...fx.config, savedKeys: { fishAudioKey: { configured: true, last4: "a1b2" } } }
      : { ok: false, reason: "rejected" });
    page();
    paste(row("fishAudio")!.querySelector<HTMLInputElement>("[data-key-input]")!, "fish-audio-abcdefghijklmnopa1b2");
    await vi.waitFor(() => expect(row("fishAudio")!.textContent).toContain("Connected"));
    expect(fx.api.mock.calls.map(([path]) => path)).toContain("/api/config");
    expect(fx.api.mock.calls.map(([path]) => path)).not.toContain("/api/keys/test");
    expect(JSON.parse(fx.api.mock.calls[0]![1].body)).toEqual({ tts: { fishKey: "fish-audio-abcdefghijklmnopa1b2" } });
    const masked = row("fishAudio")!.querySelector("[data-key-masked]")!;
    expect(masked.textContent).toContain("••••••••a1b2");
    expect(row("fishAudio")!.querySelector("[data-key-input]")).toBeNull();
    expect(row("fishAudio")!.querySelector("[data-key-replace]")).not.toBeNull();
  });

  it("removes the Boat credential and promotion row from the visible key catalog", () => {
    setConfig({ ...fx.config, box: { configured: true, last4: "c3d4" } });
    page();
    expect(row("box")).toBeNull();
    expect(host.textContent).not.toContain("Boat credit");
    type(host.querySelector<HTMLInputElement>("[data-keys-search]")!, "boat");
    expect(rowsShown()).not.toContain("box");
  });
});
