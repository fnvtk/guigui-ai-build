import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";


const fixture = vi.hoisted(() => ({ admin: false as boolean | null }));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => fixture.admin }));
vi.mock("./EnginesSettings", () => ({ EnginesSettings: () => "AI ACCOUNTS" }));
vi.mock("./LocalComputerSection", () => ({ LocalComputerSection: () => "CLOUD DESKTOPS" }));
vi.mock("./ProfileSettings", () => ({ ProfileSummaryRow: () => "ACCOUNT PROFILE" }));
vi.mock("./OpenAtLoginRow", () => ({ OpenAtLoginRow: () => null }));
vi.mock("./DefaultBotControls", () => ({ DefaultBotSidebarRow: () => null }));
vi.mock("./TalkShortcutRow", () => ({ TalkShortcutRow: () => null }));
vi.mock("./AnalyticsRow", () => ({ AnalyticsRow: () => null }));
vi.mock("./BrowserSettingsRows", () => ({ BuiltInBrowserRow: () => null }));
vi.mock("./AppSettingsRows", async (original) => ({ ...await original<object>(), BrowserProfilesRow: () => null }));
vi.mock("./LoginsSettings", () => ({ LoginsSettings: () => null }));

const { SimpleAiPage, SimpleComputerPage, SimpleGeneralPage } = await import("./SettingsSimplePages");

const has = () => true;
const remoteAccess = { client: null, domain: null, pairing: null, companion: null };
const pages = () => [
  renderToStaticMarkup(createElement(SimpleAiPage, { has })),
  renderToStaticMarkup(createElement(SimpleComputerPage, { has, remoteAccess })),
].join("\n");
const generalPage = () => renderToStaticMarkup(createElement(SimpleGeneralPage, { has: (id) => id === "general", peopleOpen: false, onLooks: () => {} }));

beforeEach(() => { fixture.admin = false; });

it("shows a session without the admin scope a plain sentence instead of the installation's AI and computers", () => {
  const html = pages();
  for (const hidden of ["AI ACCOUNTS", "KEYS", "CLOUD DESKTOPS"]) expect(html).not.toContain(hidden);
  expect(html).toContain("Only an admin of this installation can change this.");
});

it("keeps the SimpleAPI engine available to an admin without exposing provider keys", () => {
  fixture.admin = true;
  const html = pages();
  expect(html).toContain("AI ACCOUNTS");
  expect(html).not.toContain("CLOUD DESKTOPS");
  expect(html).not.toContain("KEYS");
});

it("keeps the general account settings free of Cloud purchase and trial prompts", () => {
  const html = generalPage();
  expect(html).toContain("ACCOUNT PROFILE");
  expect(html).not.toContain("data-cloud-offer");
  expect(html).not.toContain("Free trial");
  expect(html).not.toContain("Upgrade");
});
