import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";

const fixture = vi.hoisted(() => ({ config: undefined as import("@/state/store").ConfigStatus | undefined }));
vi.mock("./DesktopCapabilities", () => ({ useDesktopCapabilities: () => ({ capabilities: {} }) }));
vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  api: vi.fn(),
  useStore: () => ({ state: { appSettingsSection: "connections", instances: [], config: fixture.config }, dispatch: vi.fn() }),
}));
vi.mock("@/lib/analytics", () => ({ analyticsEnabled: () => false, setAnalyticsEnabled: vi.fn() }));

beforeEach(() => {
  fixture.config = undefined;
  vi.stubGlobal("window", {});
  vi.stubGlobal("document", { documentElement: { dataset: {} } });
  setLocale("en");
});

afterEach(() => {
  vi.unstubAllGlobals();
  setLocale("en");
});

describe("Settings → Connections", () => {
  it.each(["router", "OpenRouter", "OpenAI", "Anthropic", "Groq"])("does not show model-provider settings when searching for %s", async (typed) => {
    const { SECTIONS, sectionMatches } = await import("./SettingsModal");
    const connections = SECTIONS.find((entry) => entry.id === "connections")!;
    // The modal lowercases and trims what was typed before matching.
    expect(sectionMatches(connections, typed.trim().toLowerCase())).toBe(false);
  });

  it.each(["Composio", "connected apps"])("keeps non-provider connection settings searchable by %s", async (typed) => {
    const { SECTIONS, sectionMatches } = await import("./SettingsModal");
    const connections = SECTIONS.find((entry) => entry.id === "connections")!;
    expect(sectionMatches(connections, typed.trim().toLowerCase())).toBe(true);
  });

  it("omits model-provider API keys while retaining app, voice and computer keys", async () => {
    const { keySearchResults } = await import("./SettingsModal");
    expect(keySearchResults("openai").map((entry) => entry.id)).not.toContain("openai");
    expect(keySearchResults("Composio").map((entry) => entry.id)).toContain("composio");
    expect(keySearchResults("Fish Audio").map((entry) => entry.id)).toContain("fishAudio");
  });

  it("does not show model-provider setup details in the Simple AI page", async () => {
    const { SettingsModal } = await import("./SettingsModal");
    const html = renderToStaticMarkup(createElement(SettingsModal));
    expect(html).not.toContain("More providers for OpenCode bots");
    expect(html).not.toContain("opencode auth login");
  });

  it("does not list AI provider credentials on the Simple AI page", async () => {
    const { SettingsModal } = await import("./SettingsModal");
    const html = renderToStaticMarkup(createElement(SettingsModal));
    expect(html).not.toContain('data-api-key-row="openai"');
    expect(html).not.toContain('data-api-key-row="openrouter"');
    expect(html).not.toContain('data-api-key-row="opencodeGo"');
  });

  it("does not expose model-provider key management on a Cloud Simple AI page", async () => {
    const { configStatusFromFrame } = await import("@/state/store");
    fixture.config = configStatusFromFrame({
      composio: { configured: false },
      box: { configured: false },
      vps: { configured: false, sshAlias: "" },
      rooms: { turnTimeoutMinutes: 10 },
      mcp: { callTimeoutMinutes: 10 },
      localVm: { mode: "shared", maxInstances: 1 },
      cloudHome: true,
    });
    const { SettingsModal } = await import("./SettingsModal");
    const html = renderToStaticMarkup(createElement(SettingsModal));
    expect(html).not.toContain("OpenCode API key");
    expect(html).not.toContain("opencode auth login");
    expect(html).not.toContain("More providers for OpenCode bots");
  });
});
