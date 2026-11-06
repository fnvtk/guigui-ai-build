import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale, t } from "@/lib/i18n";
import type { AppSettingsSection } from "@/state/store";
import type { Switch } from "./SettingsPrimitives";
import { SECTIONS, SIMPLE_FOLDED, SIMPLE_HIDDEN_SECTIONS, SIMPLE_PAGES, SettingsModal, revealSettingsBlock } from "./SettingsModal";
import { SIMPLE_ADVANCED_ONLY, SimpleGeneralPage, SimpleLooksPage } from "./SettingsSimplePages";

const fixture = vi.hoisted(() => ({
  section: "general" as AppSettingsSection,
  advancedMode: false,
  config: { features: { browser: false }, browserEngine: { kind: "bundled", installable: true }, composio: { mode: "self" } } as Record<string, unknown>,
  api: vi.fn(),
  dispatch: vi.fn(),
  switches: [] as ComponentProps<typeof Switch>[],
  ownerOrAdmin: null as boolean | null,
  updater: null as import("@/lib/updater").UpdaterState | null,
  serverUpdate: null as Record<string, unknown> | null,
  rail: null as { available: boolean; hidden: boolean } | null,
  railHidden: [] as boolean[],
}));

vi.mock("./DesktopCapabilities", () => ({ useDesktopCapabilities: () => ({ capabilities: {} }) }));
vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  api: fixture.api,
  useStore: () => ({ state: { appSettingsSection: fixture.section, instances: [], bots: [], config: fixture.config }, dispatch: fixture.dispatch }),
}));
vi.mock("@/lib/interface-mode", () => ({
  useAdvancedMode: () => fixture.advancedMode,
  setAdvancedMode: vi.fn(),
}));
vi.mock("@/lib/analytics", () => ({ analyticsEnabled: () => false, setAnalyticsEnabled: vi.fn() }));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => fixture.ownerOrAdmin }));
vi.mock("@/lib/chrome-rail", () => ({ useChromeRail: () => fixture.rail, setChromeRailHidden: (hidden: boolean) => fixture.railHidden.push(hidden) }));
vi.mock("./SettingsPrimitives", async (importOriginal) => {
  const original = await importOriginal<typeof import("./SettingsPrimitives")>();
  return {
    ...original,
    Switch: (props: ComponentProps<typeof Switch>) => {
      fixture.switches.push(props);
      return createElement(original.Switch, props);
    },
  };
});
// Each page's own content has its own tests; here a marker says which ran.
const { marker } = vi.hoisted(() => ({
  marker: (name: string) => () => `MARKER:${name};`,
}));
vi.mock("./EnginesSettings", () => ({ EnginesSettings: (props: { simple?: boolean; onlySimpleApi?: boolean; registerUrl?: string }) => createElement("div", {
  "data-settings-engine-simple": String(props.simple === true),
  "data-settings-engine-only-simple-api": String(props.onlySimpleApi === true || props.simple === true),
  "data-settings-engine-register-url": props.registerUrl,
}, "MARKER:engines;") }));
vi.mock("./DecisionModelSettings", () => ({ DecisionModelSettings: marker("decisionModel") }));
vi.mock("./keys/KeysPage", () => ({ KeysPage: marker("apiKey") }));
vi.mock("./RemoteComputerSection", () => ({ RemoteComputerSection: marker("companion") }));
vi.mock("./CustomDomainSettings", () => ({ CustomDomainSettings: () => null }));
vi.mock("./CompanionSection", () => ({ CompanionSection: () => null }));
vi.mock("./ServerPairingCard", () => ({ ServerPairingCard: () => null }));
vi.mock("./ConnectedWorkspacesSettings", () => ({ ConnectedWorkspacesSettings: marker("desktopWorkspaces") }));
vi.mock("./MacLocalControl", () => ({ MacLocalControl: marker("computer") }));
vi.mock("./LocalComputerSection", () => ({ LocalComputerSection: marker("computer") }));
vi.mock("./CloudAccountSettings", () => ({ CloudAccountSettings: marker("cloudAccount") }));
vi.mock("./OrganizationSettings", () => ({ OrganizationSettings: marker("organization") }));
vi.mock("./PeopleSection", () => ({ PeopleSection: marker("people") }));
vi.mock("./ActivitySection", () => ({ ActivitySection: marker("activity") }));
vi.mock("./UsageSection", () => ({ UsageSection: marker("usage") }));
vi.mock("./WorkspaceBackupSettings", () => ({ WorkspaceBackupSettings: marker("backups") }));
vi.mock("./RoomTurnTimeoutSettings", () => ({ RoomTurnTimeoutSettings: () => null }));
vi.mock("./CompanyBackupSettings", () => ({ CompanyBackupSettings: () => null }));
vi.mock("./ImportSettings", () => ({ ImportSettings: marker("import") }));
vi.mock("./UpdatesConsent", async (importOriginal) => ({
  ...await importOriginal<typeof import("./UpdatesConsent")>(),
  UpdatesConsentRow: marker("updatesConsent"),
}));
vi.mock("./SidebarProfileMenu", async (importOriginal) => ({
  ...await importOriginal<typeof import("./SidebarProfileMenu")>(),
  useServerUpdateItem: () => fixture.serverUpdate,
}));
vi.mock("@/lib/updater", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/updater")>(),
  useUpdaterState: () => fixture.updater,
}));

const desktop = { ogb: { environments: {}, organization: {}, cloudAccount: {} } };

beforeEach(() => {
  vi.clearAllMocks();
  fixture.section = "general";
  fixture.advancedMode = false;
  fixture.config = { features: { browser: false }, browserEngine: { kind: "bundled", installable: true }, composio: { mode: "self" } };
  fixture.switches = [];
  fixture.ownerOrAdmin = null;
  fixture.updater = null;
  fixture.serverUpdate = null;
  fixture.rail = null;
  fixture.railHidden = [];
  fixture.api.mockResolvedValue({});
  vi.stubGlobal("window", desktop);
  vi.stubGlobal("document", { documentElement: { dataset: {} } });
  setLocale("en");
});

afterEach(() => {
  vi.unstubAllGlobals();
  setLocale("en");
});

const render = () => renderToStaticMarkup(createElement(SettingsModal));
const pages = (html: string) => [...html.matchAll(/data-settings-page="([^"]+)"/g)].map((match) => match[1]);
const currentPage = (html: string) => html.match(/data-settings-page="([^"]+)" aria-current="page"/)?.[1];
const blocks = (html: string) => [...html.matchAll(/data-settings-block="([^"]+)"/g)].map((match) => match[1]);
const markers = (html: string) => [...html.matchAll(/MARKER:([^;]+);/g)].map((match) => match[1]);
const groupLabels = (html: string) => [...html.matchAll(/<h3 id="[^"]*" class="[^"]*">([^<]+)<\/h3>/g)].map((match) => match[1]);

/** Where each folded region (`hidden`) starts and ends in the markup. */
function foldedRanges(html: string): Array<[number, number]> {
  return [...html.matchAll(/<div[^>]*\bhidden=""[^>]*>/g)].map((open) => {
    const tags = /<\/?div\b[^>]*>/g;
    tags.lastIndex = open.index! + open[0].length;
    let depth = 1;
    for (let tag = tags.exec(html); tag && depth > 0; tag = depth > 0 ? tags.exec(html) : null) depth += tag[0].startsWith("</") ? -1 : 1;
    return [open.index!, tags.lastIndex];
  });
}
const placement = (html: string, needle: string): "shown" | "folded" | "missing" => {
  const at = html.indexOf(needle);
  if (at < 0) return "missing";
  return foldedRanges(html).some(([from, to]) => at > from && at < to) ? "folded" : "shown";
};
const open = (section: AppSettingsSection) => { fixture.section = section; return render(); };

describe("Settings in Simple mode", () => {
  it("draws General, AI, Membership and Computer as everyday pages", () => {
    const html = render();
    expect(pages(html)).toEqual(["general", "ai", "membership", "computer"]);
    expect(SIMPLE_PAGES.map((page) => page.id)).toEqual(["general", "ai", "membership", "computer"]);
    expect(html).toContain('<option value="membership">Usage</option>');
    expect(html).not.toContain("data-settings-group=");
    expect(html).not.toContain("data-settings-section=");
    expect(html).not.toMatch(/class="(?:[^"]*\s)?uppercase(?:\s[^"]*)?"/);
    for (const hidden of ["backups", "experimental", "workspaces", "skills"]) expect(html).not.toContain(`value="${hidden}"`);
    const picker = html.match(/<select aria-label="Settings"[\s\S]*?<\/select>/)![0];
    expect([...picker.matchAll(/<option value="([^"]+)"/g)].map((match) => match[1])).toEqual(["general", "ai", "membership", "computer"]);
    expect(html).toContain('data-settings-look="simple"');
  });

  it("files every Advanced page under one Simple page, or hides it", () => {
    const placed = SIMPLE_PAGES.flatMap((page) => page.sections);
    expect(new Set(placed).size).toBe(placed.length);
    const hidden = SECTIONS.map((entry) => entry.id).filter((id) => !placed.includes(id));
    expect(hidden).toEqual(["connections", "decisionModel", "skills", "backups", "workspaces", "experimental"]);
    for (const id of hidden.filter((id) => id !== "connections")) expect(SIMPLE_HIDDEN_SECTIONS).toContain(id);
  });

  it("opens General on Account and keeps Advanced mode under Management", () => {
    const html = render();
    expect(currentPage(html)).toBe("general");
    expect(groupLabels(html)).toEqual(["Account"]);
    expect(html).toContain("账号与成员");
    expect(html).toContain("外观与通知");
    expect(html).toContain("启动与偏好");
    expect(html).toContain("管理与数据");
    expect(html).not.toContain(">Appearance<");
    expect(html).not.toContain(">Notifications<");
    expect(html).toContain("Add your name");
    expect(html).toMatch(/aria-expanded="false" aria-controls="[^"]+"[^>]*>Add<\/button>/);
    const management = renderToStaticMarkup(createElement(SimpleGeneralPage, { has: () => true, section: "organization", peopleOpen: false, onLooks: () => {} }));
    expect(management).toContain("advanced-mode");
    expect(management).toContain('aria-label="Advanced mode"');
    expect(management).toContain("Show every control, including tools for builders. Nothing is deleted either way.");
  });

  it("puts the sidebar's colour and picture right under Theme in General, the switch for the window's rail beside them, and only the skins behind More looks", () => {
    fixture.rail = { available: true, hidden: false };
    const html = open("appearance");
    const appearance = html.slice(html.indexOf('data-settings-block="appearance"'), html.indexOf(">Notifications<"));
    const order = ['role="radiogroup" aria-label="Theme"', ">Sidebar picture<", 'aria-label="Show your computers"', 'aria-label="Color my messages with the bot&#x27;s color"', ">More looks<"]
      .map((needle) => appearance.indexOf(needle));
    expect(order.every((at) => at > -1), String(order)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(appearance).toContain("A circle for each place your bots live, at the window&#x27;s left edge.");
    const toggle = fixture.switches.find((props) => props["aria-label"] === "Show your computers")!;
    expect(toggle.checked).toBe(true);
    toggle.onClick!({} as never);
    expect(fixture.railHidden).toEqual([true]);
    const looks = renderToStaticMarkup(createElement(SimpleLooksPage, { onBack: () => {} }));
    expect(looks).toContain('data-settings-block="looks"');
    expect(looks).not.toContain("data-place-picture");
  });

  it("shows the rail's switch only where this window has a rail to hide", () => {
    for (const rail of [null, { available: false, hidden: true }]) {
      fixture.rail = rail;
      expect(render()).not.toContain("Show your computers");
    }
    fixture.rail = { available: true, hidden: true };
    open("appearance");
    expect(fixture.switches.find((props) => props["aria-label"] === "Show your computers")?.checked).toBe(false);
  });

  it("keeps the everyday rows and leaves the fourteen builder controls to Advanced, where search still points", () => {
    const general = open("appearance");
    for (const shown of ['aria-label="Color my messages with the bot&#x27;s color"', 'aria-label="Send messages with"',
      'aria-label="Notification sounds"', 'aria-label="Show the notification feed"', 'aria-label="App language"', 'role="radiogroup" aria-label="Theme"']) {
      expect(placement(general, shown), shown).toBe("shown");
    }
    expect(renderToStaticMarkup(createElement(SimpleGeneralPage, { has: () => true, section: "general", peopleOpen: false, onLooks: () => {} }))).not.toContain('aria-label="Send usage analytics"');
    expect(open("updates")).not.toContain("MARKER:updatesConsent;");
    const everyPage = ["general", "engines", "companion", "usage", "updates"].map((section) => open(section as AppSettingsSection)).join("");
    for (const gone of ["Effort for new bots", "Defaults for new bots", "Group turns", "MCP calls", "Parallel threads", "Automatic recovery", "Event log cleanup",
      "Interface font", "Chat width", "Pinned bots as circles", "Universal pins", "Tool calls", "This run", "Keep prompt cache warm"]) {
      expect(everyPage, gone).not.toContain(`>${gone}<`);
    }
    expect(SIMPLE_ADVANCED_ONLY).toHaveLength(14);
    expect(SIMPLE_ADVANCED_ONLY.map((key) => t(key))).toEqual(expect.arrayContaining(["Effort for new bots", "Interface font", "Keep prompt cache warm"]));
  });



  it("hides provider API keys and removed desktop workspace controls", () => {
    expect(open("connections")).not.toContain("MARKER:apiKey;");
    expect(open("engines")).not.toContain("MARKER:apiKey;");
    expect(placement(open("desktopWorkspaces"), "MARKER:desktopWorkspaces;")).toBe("missing");
    expect(open("remote")).not.toContain("MARKER:companion;");
    expect(placement(open("companion"), "MARKER:companion;")).toBe("missing");
    expect(SIMPLE_FOLDED).toEqual({});
  });

  it("shows only the engines section on the AI page", () => {
    fixture.section = "engines";
    const html = render();
    expect(currentPage(html)).toBe("ai");
    expect(blocks(html)).toEqual(["engines"]);
    expect(markers(html).filter((name) => name === "engines" || name === "decisionModel")).toEqual(["engines"]);
    expect(html).not.toContain("API keys");
    expect(html).not.toContain("MARKER:apiKey;");
    expect(html).toContain('data-settings-engine-only-simple-api="true"');
    expect(html).toContain('data-settings-engine-register-url="https://simpleapi.quwanzhi.com/register"');
  });

  it("orders Computer as your bots' computers, your devices, the browser, logins, then Connect from elsewhere", () => {
    fixture.section = "companion";
    const html = render();
    expect(currentPage(html)).toBe("computer");
    expect(blocks(html)).toEqual(["companion"]);
    expect(html).toContain("连接手机");
    expect(html).not.toContain('aria-label="Enable the built-in browser"');
  });

  it("redirects old Cloud account settings links to General", () => {
    const html = open("cloudAccount");
    expect(currentPage(html)).toBe("general");
    expect(html).not.toContain("MARKER:cloudAccount;");
    expect(html).not.toContain("See all limits");
  });

  it("sends removed commercial pages to General", () => {
    for (const section of ["updates"] as const) {
      const html = open(section);
      expect(currentPage(html)).toBe("general");
      expect(html).not.toContain("MARKER:updatesConsent;");
      expect(html).not.toContain("MARKER:usage;");
    }
    expect(currentPage(open("usage"))).toBe("membership");
  });

  it("shows a hosted workspace's admins People in Account and Activity as its own group", () => {
    vi.stubGlobal("window", {});
    fixture.ownerOrAdmin = true;
    fixture.section = "people";
    const html = render();
    expect(pages(html)).toEqual(["general", "ai", "membership", "computer"]);
    expect(currentPage(html)).toBe("general");
    expect(placement(html, "MARKER:people;")).toBe("shown");
    expect(placement(open("activity"), "MARKER:activity;")).toBe("shown");
  });

  it("keeps a paired remote client's reduced set: General and the phone pairing page", () => {
    vi.stubGlobal("window", { ogb: { ...desktop.ogb, remoteClient: { active: true } } });
    fixture.section = "desktopWorkspaces";
    const html = render();
    expect(pages(html)).toEqual(["general", "computer"]);
    expect(currentPage(html)).toBe("computer");
    expect(blocks(html)).toEqual(["companion"]);
    expect(html).not.toContain("desktopWorkspaces");
    expect(html).not.toContain('aria-label="Enable the built-in browser"');
    fixture.section = "appearance";
    const general = render();
    expect(currentPage(general)).toBe("general");
    expect(general).not.toContain("Add your name");
    expect(general).toContain('aria-label="App language"');
    expect(renderToStaticMarkup(createElement(SimpleGeneralPage, { has: () => true, section: "organization", peopleOpen: false, onLooks: () => {} }))).toContain('aria-label="Advanced mode"');
  });

  it.each<[AppSettingsSection, string]>([
    ["general", "general"],
    ["appearance", "general"],
    ["import", "general"],
    ["engines", "ai"],
    ["companion", "computer"],
    ["remote", "computer"],
    ["computer", "computer"],
    ["logins", "computer"],
    ["cloudAccount", "general"],
  ])("lands a deep link to %s on %s", (section, page) => {
    fixture.section = section;
    const html = render();
    expect(currentPage(html)).toBe(page);
    expect(blocks(html)).toContain(section === "remote" ? "companion" : section === "cloudAccount" ? "general" : section);
  });

  it.each(["organization", "desktopWorkspaces"] as const)("redirects removed %s settings to General", (section) => {
    const html = open(section);
    expect(currentPage(html)).toBe("general");
    expect(html).not.toContain("MARKER:organization;");
    expect(html).not.toContain("MARKER:desktopWorkspaces;");
  });

  it("keeps API-key provider settings out of Simple mode, including a direct deep link", () => {
    fixture.section = "connections";
    const html = render();
    expect(html).not.toContain("MARKER:apiKey;");
    expect(html).not.toContain("API keys");
  });

  it.each<[AppSettingsSection, string]>([
    ["backups", "backups"],
    ["experimental", "skillAuthoring"],
    // The add-a-key suggestion's Add key opens it straight away.
    ["decisionModel", "decisionModel"],
  ])("opens a hidden page (%s) for as long as it is the open one", (section, content) => {
    fixture.section = section;
    const html = render();
    expect(pages(html)).toEqual(["general", "ai", "membership", "computer", section]);
    expect(currentPage(html)).toBe(section);
    if (content === "skillAuthoring") expect(html).toContain("Bots may write their own skills");
    else expect(markers(html)).toContain(content);
  });

  it("scrolls a later section of a stacked page to the top of the scroller alone, and starts a page at its top", () => {
    const block = { getBoundingClientRect: () => ({ top: 500 }) };
    const querySelector = vi.fn(() => block);
    const scroller = { scrollTop: 320, clientHeight: 600, getBoundingClientRect: () => ({ top: 100 }), querySelector };
    revealSettingsBlock(scroller, "connections", 1);
    expect(querySelector).toHaveBeenCalledWith('[data-settings-block="connections"]');
    expect(scroller.scrollTop).toBe(720);
    revealSettingsBlock(scroller, "engines", 0);
    expect(scroller.scrollTop).toBe(0);
    expect(querySelector).toHaveBeenCalledTimes(1);
  });
});

describe("Settings in Advanced mode", () => {
  beforeEach(() => { fixture.advancedMode = true; });

  it("filters the Advanced AI page to SimpleAPI and uses its verified registration address", () => {
    fixture.section = "engines";
    const html = render();
    expect(html).toContain('data-settings-engine-only-simple-api="true"');
    expect(html).toContain('data-settings-engine-register-url="https://simpleapi.quwanzhi.com/register"');
    expect(markers(html)).toContain("engines");
    expect(markers(html)).not.toContain("apiKey");
  });

  it("keeps the grouped rail and General, Advanced mode switch first, on the same Settings look as Simple", () => {
    const html = render();
    expect(html).toContain("glass-surface");
    expect(html).toContain('data-settings-look="advanced"');
    expect(html).not.toContain("data-settings-page=");
    expect([...html.matchAll(/data-settings-group="([^"]+)"/g)].map((match) => match[1])).toEqual(["you", "ai", "computers", "account"]);
    expect(html.indexOf('aria-label="Advanced mode"')).toBeLessThan(html.indexOf("Language"));
    expect(html).toContain("Show every technical control on this device");
    expect(html).not.toContain("More settings");
    for (const kept of ["Group turns", 'aria-label="Effort for new bots"', 'aria-label="Send usage analytics"', "Diagnostics"]) {
      expect(placement(html, kept), kept).toBe("shown");
    }
  });

  it("treats a link to Updates as General", () => {
    fixture.section = "updates";
    const html = render();
    expect(html).toContain('data-settings-section="general" aria-current="page"');
  });
});

describe("the built-in browser switch", () => {
  const browserSwitch = () => fixture.switches.find((props) => props["aria-label"] === "Enable the built-in browser");

  it.each([false, true])("writes features.browser from Devices (advanced: %s)", async (advanced) => {
    fixture.advancedMode = advanced;
    fixture.section = advanced ? "computer" : "logins";
    const html = render();
    if (advanced) {
      expect(html).toContain('aria-label="Enable the built-in browser"');
      expect(html).not.toContain("MARKER:computer;");
    } else {
      expect(html).not.toContain("MARKER:computer;");
      expect(html).toContain('aria-label="Enable the built-in browser"');
    }
    const toggle = browserSwitch()!;
    expect(toggle.checked).toBe(false);
    toggle.onClick!({} as never);
    await vi.waitFor(() => expect(fixture.dispatch).toHaveBeenCalledWith({ type: "configStatus", config: {} }));
    expect(fixture.api).toHaveBeenCalledWith("/api/config", {
      method: "PATCH",
      body: JSON.stringify({ features: { browser: true } }),
    });
  });

  it("is no longer on Experimental, which keeps skill drafting", () => {
    fixture.advancedMode = true;
    fixture.section = "experimental";
    const html = render();
    expect(html).not.toContain('aria-label="Enable the built-in browser"');
    expect(html).toContain("Bots may write their own skills");
    expect(browserSwitch()).toBeUndefined();
  });

  it("is found by searching for the browser under Bot desktops in Advanced", () => {
    const computer = SECTIONS.find((entry) => entry.id === "computer")!;
    const experimental = SECTIONS.find((entry) => entry.id === "experimental")!;
    expect(computer.keywords).toContain("browser");
    expect(experimental.keywords).not.toContain("browser");
  });
});
