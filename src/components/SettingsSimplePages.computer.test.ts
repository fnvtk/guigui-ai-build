import { Window } from "happy-dom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { SimpleComputerPage } from "./SettingsSimplePages";
vi.mock("./MacLocalControl", () => ({ MacLocalControl: () => createElement("div", null, "本机权限") }));
vi.mock("./LocalComputerSection", () => ({ LocalComputerSection: () => createElement("div", null, "SSH 技术配置") }));
vi.mock("./AdminOnly", () => ({ AdminOnly: ({ children }: { children: React.ReactNode }) => children }));
it("keeps local permissions, phone setup and browser settings without desktop workspace entries", async () => {
  const window = new Window();
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", window.document);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () => root.render(createElement(SimpleComputerPage, { has: () => true, remoteAccess: { client: null, domain: null, pairing: "配对码", companion: "手机设备" } })));
  expect(host.querySelectorAll('[role="tab"]')).toHaveLength(3);
  expect(host.textContent).toContain("本机权限");
  expect(host.textContent).not.toContain("SSH 技术配置");
  expect(host.textContent).not.toContain("服务器列表");
  await act(async () => (host.querySelector('#computer-tab-devices') as HTMLButtonElement).click());
  expect(host.textContent).toContain("配对码");
  expect(host.textContent).not.toContain("本机权限");
  await act(async () => (host.querySelector('#computer-tab-browser') as HTMLButtonElement).click());
  expect(host.querySelector('#computer-panel-browser')).not.toBeNull();
  expect(host.querySelector('#computer-tab-advanced')).toBeNull();
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

vi.mock('./AnalyticsRow', () => ({ AnalyticsRow: () => null }));

vi.mock('./OpenAtLoginRow', () => ({ OpenAtLoginRow: () => null }));

vi.mock('./DefaultBotControls', () => ({ DefaultBotSidebarRow: () => null }));

vi.mock('./TalkShortcutRow', () => ({ TalkShortcutRow: () => null }));

vi.mock('./EnginesSettings', () => ({ EnginesSettings: () => null }));

vi.mock('./PeopleSection', () => ({ PeopleSection: () => null }));

vi.mock('./ActivitySection', () => ({ ActivitySection: () => null }));

vi.mock('./bot-access/AccessOverview', () => ({ AccessOverview: () => null }));

vi.mock('./BrowserSettingsRows', () => ({ BuiltInBrowserRow: () => null }));

vi.mock('./LoginsSettings', () => ({ LoginsSettings: () => null }));

vi.mock('./OrganizationSettings', () => ({ OrganizationSettings: () => null }));

vi.mock('./SkinPicker', () => ({ SkinPicker: () => null }));

vi.mock('./PlaceLookCard', () => ({ PlaceLookRows: () => null }));

vi.mock('./ChromeRailToggle', () => ({ ChromeRailRow: () => null }));

vi.mock('./WindowFrameRow', () => ({ WindowFrameRow: () => null }));

vi.mock('./ProfileSettings', () => ({ ProfileSummaryRow: () => null }));

vi.mock('./ImportSettings', () => ({ ImportSettings: () => null }));

vi.mock('./NotificationSettingsRows', () => ({ NotificationRows: () => null }));

vi.mock('./AppSettingsRows', () => ({ AdvancedModeRow: () => null, BrowserProfilesRow: () => null, ColorUserBubblesRow: () => null, FollowUpRow: () => null, LanguageRow: () => null, SendKeyRow: () => null }));

vi.mock('./ThemeRow', () => ({ ThemeRow: () => null }));
vi.mock('./SettingsPrimitives', () => ({ SettingsGroup: ({ children }: { children: React.ReactNode }) => children, SettingsRows: ({ children }: { children: React.ReactNode }) => children, SettingRow: () => null, SettingsDisclosureRow: () => null }));
