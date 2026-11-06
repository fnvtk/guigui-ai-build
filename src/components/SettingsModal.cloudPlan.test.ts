import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettingsSection } from "@/state/store";
import { SettingsModal } from "./SettingsModal";

const fixture = vi.hoisted(() => ({ section: "cloudAccount" as AppSettingsSection, config: { rooms: { turnTimeoutMinutes: 5 }, threads: {} } as Record<string, unknown>, advanced: false }));
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => fixture.advanced, setAdvancedMode: vi.fn() }));
vi.mock("./DesktopCapabilities", () => ({ useDesktopCapabilities: () => ({ capabilities: {} }) }));
vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  api: vi.fn(),
  useStore: () => ({ state: { appSettingsSection: fixture.section, config: fixture.config, instances: [], bots: [] }, dispatch: vi.fn() }),
}));
vi.mock("./CloudAccountSettings", () => ({
  CloudAccountSettings: ({ cloudHome, onAddCloud }: { cloudHome?: boolean; onAddCloud?: () => void }) => `CLOUD_PLAN_MARKER${cloudHome ? " home" : ""}${onAddCloud ? " offer" : ""}`,
}));
vi.mock("./AutomaticRecoverySettings", () => ({ AutomaticRecoverySettings: () => null }));
vi.mock("./RoomTurnTimeoutSettings", () => ({ RoomTurnTimeoutSettings: () => null }));

const plan = { state: vi.fn(), manage: vi.fn() };
beforeEach(() => {
  fixture.section = "cloudAccount"; fixture.config = { rooms: { turnTimeoutMinutes: 5 }, threads: {} };
  vi.stubGlobal("document", { documentElement: { dataset: {} } });
});
afterEach(() => { vi.unstubAllGlobals(); });
const render = () => renderToStaticMarkup(createElement(SettingsModal));

describe.each(["Simple", "Advanced"] as const)("%s Settings after removing Cloud account settings", (mode) => {
  beforeEach(() => { fixture.advanced = mode === "Advanced"; });
  const expectNoCloudEntryAndGeneral = (html: string) => {
    expect(html).not.toContain("CLOUD_PLAN_MARKER");
    expect(html).not.toContain('data-settings-section="cloudAccount"');
    expect(html).not.toContain('data-settings-block="cloudAccount"');
    expect(html).toContain(fixture.advanced ? 'data-settings-section="general" aria-current="page"' : 'data-settings-page="general" aria-current="page"');
  };

  it("redirects an old Cloud account deep link to General when only a plan bridge exists", () => {
    vi.stubGlobal("window", { ogb: { cloudPlan: plan } });
    expectNoCloudEntryAndGeneral(render());
  });

  it("keeps the old Cloud link unavailable on a Cloud home", () => {
    vi.stubGlobal("window", { ogb: { cloudPlan: plan } });
    fixture.config = { rooms: { turnTimeoutMinutes: 5 }, threads: {}, cloudHome: true };
    expectNoCloudEntryAndGeneral(render());
  });

  it("does not restore the account entry when the native account bridge exists", () => {
    vi.stubGlobal("window", { ogb: { cloudAccount: {}, cloudPlan: plan } });
    expectNoCloudEntryAndGeneral(render());
  });
});
