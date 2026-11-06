// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("./ProfileSettings", () => ({ ProfileSummaryRow: () => createElement("span", null, "PROFILE") }));
vi.mock("./PeopleSection", () => ({ PeopleSection: () => createElement("span", null, "PEOPLE") }));
vi.mock("./AnalyticsRow", () => ({ AnalyticsRow: () => createElement("span", null, "ANALYTICS") }));
vi.mock("./OpenAtLoginRow", () => ({ OpenAtLoginRow: () => createElement("span", null, "OPEN AT LOGIN") }));
vi.mock("./DefaultBotControls", () => ({ DefaultBotSidebarRow: () => createElement("span", null, "DEFAULT BOT") }));
vi.mock("./TalkShortcutRow", () => ({ TalkShortcutRow: () => createElement("span", null, "TALK SHORTCUT") }));
vi.mock("./ActivitySection", () => ({ ActivitySection: () => createElement("span", null, "ACTIVITY") }));
vi.mock("./bot-access/AccessOverview", () => ({ AccessOverview: () => createElement("span", null, "BOT ACCESS") }));
vi.mock("./ImportSettings", () => ({ ImportSettings: () => createElement("span", null, "IMPORT") }));
vi.mock("./OrganizationSettings", () => ({ OrganizationSettings: () => createElement("span", null, "ORGANIZATION") }));
vi.mock("./NotificationSettingsRows", () => ({ NotificationRows: () => createElement("span", null, "NOTIFICATIONS") }));
vi.mock("./PlaceLookCard", () => ({ PlaceLookRows: () => createElement("span", null, "PLACE LOOKS") }));
vi.mock("./ChromeRailToggle", () => ({ ChromeRailRow: () => createElement("span", null, "COMPUTER RAIL") }));
vi.mock("./WindowFrameRow", () => ({ WindowFrameRow: () => createElement("span", null, "WINDOW FRAME") }));
vi.mock("./AppSettingsRows", () => ({
  AdvancedModeRow: () => createElement("span", null, "ADVANCED MODE"),
  ColorUserBubblesRow: () => createElement("span", null, "MESSAGE COLORS"),
  FollowUpRow: () => createElement("span", null, "FOLLOW UP"),
  LanguageRow: () => createElement("span", null, "LANGUAGE"),
  SendKeyRow: () => createElement("span", null, "SEND KEY"),
}));
vi.mock("./ThemeRow", () => ({ ThemeRow: () => createElement("span", null, "THEME") }));
vi.mock("./AdminOnly", () => ({ AdminOnly: ({ children }: { children: ReactNode }) => children }));

import { SimpleGeneralPage } from "./SettingsSimplePages";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(createElement(SimpleGeneralPage, { has: () => true, peopleOpen: false, onLooks: () => {} })));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function select(id: string) {
  act(() => host.querySelector<HTMLButtonElement>(`#general-tab-${id}`)!.click());
  return host.querySelector('[role="tabpanel"]')!.textContent ?? "";
}

it("shows one short category at a time and opens all four General categories", () => {
  expect(host.querySelectorAll('[role="tab"]')).toHaveLength(4);
  expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("账号与成员");
  expect(host.textContent).toContain("PROFILE");
  expect(host.textContent).not.toContain("THEME");

  expect(select("appearance")).toContain("THEME");
  expect(host.textContent).toContain("NOTIFICATIONS");
  expect(host.textContent).not.toContain("PROFILE");

  const system = select("system");
  expect(system).toContain("OPEN AT LOGIN");
  expect(system).toContain("DEFAULT BOT");
  expect(system).toContain("TALK SHORTCUT");
  expect(system).toContain("ANALYTICS");
  expect(system).not.toContain("PROFILE");

  const management = select("management");
  for (const label of ["IMPORT", "ORGANIZATION", "BOT ACCESS", "ACTIVITY", "ADVANCED MODE"]) expect(management).toContain(label);
  expect(management).not.toContain("THEME");
});
