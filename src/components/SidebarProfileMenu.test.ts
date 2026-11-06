import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  phoneMenuItems,
  placeMenuItems,
  profileInitials,
  profileMenuItems,
  accountDot,
  accountLabel,
  toolMenuItems,
  selectPhoneDestination,
  profileLabel,
} from "./SidebarProfileMenu";
import { platformLabel } from "@/lib/app-links";
import { profileForSession } from "@/lib/session";
import {
  cloudPhoneDestination,
  connectPhoneEntry,
  phoneDestinations,
  phonePairingSettingsAction,
  type PhonePairingAccess,
  type PhonePairingTarget,
} from "@/lib/phone-pairing";
import type { CloudAccountState } from "../../electron/cloud-account.mjs";
import type { CloudMachine } from "../../electron/cloud-home.mjs";
import type { SidebarMenuItem } from "./SidebarPopoverMenu";
import { moveMenuItems } from "./AccountMove";
import { moveLine } from "@/lib/cloud-send";
import { InitialsAvatar } from "./Avatar";

describe("profileInitials", () => {
  it("takes the first letter of the first two words", () => {
    expect(profileInitials({ name: "Milind Soni" })).toBe("MS");
    expect(profileInitials({ name: "Ada Byron Lovelace" })).toBe("AB");
  });

  it("falls back to the email, then to a placeholder", () => {
    expect(profileInitials({ email: "you@x.dev" })).toBe("Y");
    expect(profileInitials({})).toBe("?");
    expect(profileInitials(undefined)).toBe("?");
  });

  it("ignores whitespace-only names", () => {
    expect(profileInitials({ name: "   ", email: "you@x.dev" })).toBe("Y");
  });
});

describe("profileLabel", () => {
  it("prefers the name, then the email, then You", () => {
    expect(profileLabel({ name: "Omkar", email: "o@x.dev" })).toBe("Omkar");
    expect(profileLabel({ email: "o@x.dev" })).toBe("o@x.dev");
    expect(profileLabel(undefined)).toBe("You");
  });
});

describe("the sidebar profile for a signed-in visitor", () => {
  it("uses the fallback while the session identity is still loading", () => {
    const visible = profileForSession(
      { name: "Owner", email: "owner@example.test", avatarUrl: "/owner.png" },
      null,
    );
    expect(profileLabel(visible)).toBe("You");
    expect(profileInitials(visible)).toBe("?");
    expect(visible?.avatarUrl).toBeUndefined();
  });

  it("shows the verified email and initials without the configured owner's name or avatar", () => {
    const visible = profileForSession(
      { name: "Owner", email: "owner@example.test", avatarUrl: "/owner.png" },
      { kind: "session", id: "s", label: "Ada's iPad", email: "ada@example.test", scopes: ["client"], expiresAt: 1 },
    );
    expect(profileLabel(visible)).toBe("ada@example.test");
    expect(profileInitials(visible)).toBe("A");
    expect(visible?.avatarUrl).toBeUndefined();
  });
});

describe("platformLabel", () => {
  it("names the platforms we ship, and stays quiet otherwise", () => {
    expect(platformLabel("darwin")).toBe("macOS");
    expect(platformLabel("win32")).toBe("Windows");
    expect(platformLabel("linux")).toBe("Linux");
    expect(platformLabel("freebsd")).toBeNull();
    expect(platformLabel(undefined)).toBeNull();
  });
});

describe("the phone entries", () => {
  const admin: PhonePairingAccess = { session: { kind: "session", id: "s", label: "Mac", scopes: ["admin", "client"], expiresAt: 1 }, pairingCodes: true };
  const chatOnly: PhonePairingAccess = { session: { kind: "session", id: "s", label: "Phone", scopes: ["client"], expiresAt: 1 }, pairingCodes: true };
  const signedIn = { status: "connected", account: { id: "a", email: "p@example.test" } } as const;
  const paid = (tier: string, machine?: CloudMachine): CloudAccountState => ({ ...signedIn, entitlement: { plan: "pro", tier, status: "active", expiresAt: null, version: 1 }, ...(machine ? { machine } : {}) });
  const ready: CloudMachine = { status: "ready", origin: "https://home-7f3k2.fly.dev" };
  const free: CloudAccountState = { ...signedIn, entitlement: { plan: "free", status: "inactive", expiresAt: null, version: 1 } };
  const items = (target: PhonePairingTarget, access: PhonePairingAccess | null, account: CloudAccountState | null = null, connected = false) => {
    const onConnect = vi.fn();
    const destinations = phoneDestinations(connectPhoneEntry(target, access), cloudPhoneDestination(account));
    return { list: phoneMenuItems({ destinations, connected, onConnect }), onConnect };
  };
  const shown = (...args: Parameters<typeof items>) => items(...args).list.map((item) => [item.label, item.subtitle ?? null, ...(item.note ? [item.note] : [])]);

  it("on this computer: Connect your phone, to this computer", () => {
    expect(shown("computer", null)).toEqual([["Connect your phone", "to this computer"]]);
  });

  it("on this computer with a paid Cloud that is Ready: both, the Cloud first", () => {
    for (const tier of ["personal", "pro", "max"]) {
      expect(shown("computer", null, paid(tier, ready))).toEqual([
        ["Connect your phone", "to the Cloud (always on)"],
        ["Connect your phone", "to this computer"],
      ]);
    }
  });

  it("on this computer, free or signed out: only this computer", () => {
    for (const account of [free, { status: "signed-out" } as CloudAccountState, null]) {
      expect(shown("computer", null, account)).toEqual([["Connect your phone", "to this computer"]]);
    }
    expect(shown("computer", null, { ...paid("pro", ready), entitlement: { plan: "pro", status: "inactive", expiresAt: null, version: 2 } }))
      .toEqual([["Connect your phone", "to this computer"]]);
    expect(shown("computer", null, { status: "unavailable", lastPlan: { tier: "pro", active: true }, machine: ready }))
      .toEqual([["Connect your phone", "to this computer"]]);
  });

  it("on this computer with a paid Cloud that is not Ready: only this computer, and a hint", () => {
    for (const machine of [undefined, { status: "provisioning" }, { status: "stopped", origin: ready.origin }, { status: "failed", origin: ready.origin }] as Array<CloudMachine | undefined>) {
      expect(shown("computer", null, paid("pro", machine))).toEqual([
        ["Connect your phone", "to this computer", "The Cloud shows here once it's ready."],
      ]);
    }
  });

  it("on the person's own Cloud: one Connect your phone to My Cloud", () => {
    expect(shown("cloud", admin)).toEqual([["Connect your phone", "to the Cloud"]]);
    expect(shown("cloud", admin, paid("max", ready))).toEqual([["Connect your phone", "to the Cloud"]]);
    expect(shown("cloud", admin, paid("max"))).toEqual([["Connect your phone", "to the Cloud"]]);
  });

  it("on another server: to this server, and gone for a session that cannot make a pairing code", () => {
    expect(shown("server", admin, paid("pro", ready))).toEqual([["Connect your phone", "to the bots here"]]);
    expect(shown("server", chatOnly)).toEqual([]);
    expect(shown("server", { ...admin, pairingCodes: false })).toEqual([]);
    expect(shown("cloud", chatOnly)).toEqual([]);
  });

  it("only shows a pairing destination when available", () => {
    for (const target of ["computer", "server"] as const) {
      expect(items(target, null).list.map((item) => item.label)).not.toContain("Get OpenMausBot for iOS");
    }
  });

  it("each line hands on its own destination", () => {
    const { list, onConnect } = items("computer", null, paid("pro", ready));
    list[0]!.onSelect();
    expect(onConnect).toHaveBeenLastCalledWith(expect.objectContaining({ id: "cloud" }));
    list[1]!.onSelect();
    expect(onConnect).toHaveBeenLastCalledWith(expect.objectContaining({ id: "here", target: "computer" }));
  });

  it("shows this computer's live phone on this computer's line only", () => {
    expect(items("computer", null, null, true).list[0]!.trailing).toBeTruthy();
    expect(items("computer", null, null, false).list[0]!.trailing).toBeUndefined();
    const both = items("computer", null, paid("pro", ready), true).list;
    expect(both[0]!.trailing).toBeUndefined();
    expect(both[1]!.trailing).toBeTruthy();
    expect(items("cloud", admin, null, true).list[0]!.trailing).toBeUndefined();
  });
});

describe("choosing where the phone connects", () => {
  const destinations = (account: CloudAccountState | null) => phoneDestinations(connectPhoneEntry("computer", null), cloudPhoneDestination(account));
  const readyCloud: CloudAccountState = { status: "connected", entitlement: { plan: "pro", status: "active", expiresAt: null, version: 1 }, machine: { status: "ready", origin: "https://home-7f3k2.fly.dev" } };
  const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

  it("to My Cloud opens the Cloud on its phone pairing, as Use the Cloud on your phone does, sending nothing", async () => {
    const bridge = { connectHomeForPhone: vi.fn().mockResolvedValue({ status: "connected" }) };
    const dispatch = vi.fn();
    selectPhoneDestination(destinations(readyCloud)[0]!, { bridge, dispatch });
    await flush();
    expect(bridge.connectHomeForPhone).toHaveBeenCalledExactlyOnceWith();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("when the Cloud cannot be opened, lands on Settings → MausBot Cloud, which says what to do", async () => {
    const bridge = { connectHomeForPhone: vi.fn().mockRejectedValue(new Error("offline")) };
    const dispatch = vi.fn();
    selectPhoneDestination(destinations(readyCloud)[0]!, { bridge, dispatch });
    await flush();
    expect(dispatch).toHaveBeenCalledExactlyOnceWith({ type: "toggleAppSettings", open: true, section: "cloudAccount" });
  });

  it("to this computer opens this computer's phone pairing and never touches the Cloud", () => {
    const bridge = { connectHomeForPhone: vi.fn() };
    const dispatch = vi.fn();
    selectPhoneDestination(destinations(readyCloud)[1]!, { bridge, dispatch });
    expect(dispatch).toHaveBeenCalledExactlyOnceWith(phonePairingSettingsAction());
    expect(bridge.connectHomeForPhone).not.toHaveBeenCalled();
  });
});

describe("profileMenuItems", () => {
  const noop = () => {};
  const build = (patch: Partial<Parameters<typeof profileMenuItems>[0]> = {}) => profileMenuItems({
    phone: [],
    account: "OpenMausBot Cloud",
    onSettings: noop, onShortcuts: noop, onAbout: noop, onAccount: noop,
    ...patch,
  });

  it("shows the phone, shortcuts, settings and account without usage, Help or feedback rows", () => {
    const items = build();
    expect(items.map((item) => item.key)).toEqual(["support", "settings", "account"]);
    expect(items.filter((item) => item.separatorBefore).map((item) => item.key)).toEqual(["account"]);
    expect(items.find((item) => item.key === "support")!.submenu!.map((item) => item.key)).toEqual(["shortcuts", "about"]);
    expect(items.find((item) => item.key === "account")!.label).toBe("OpenMausBot Cloud");
  });

  it("does not show an account without one", () => {
    const items = build({ account: null });
    expect(items.map((item) => item.key)).toEqual(["support", "settings"]);
    expect(items.some((item) => item.separatorBefore)).toBe(false);
  });

  it("opens the account settings", () => {
    const onAccount = vi.fn();
    const items = build({ onAccount });
    items.find((item) => item.key === "account")!.onSelect();
    expect(onAccount).toHaveBeenCalledOnce();
  });
});

describe("Simple mode's account menu", () => {
  const noop = () => {};
  const tools = toolMenuItems({ activeView: "routines", automationsNeedYou: true, onAutomations: noop, onTeamMap: noop });
  const place = (patch: Partial<Parameters<typeof placeMenuItems>[0]> = {}) => ({
    bridge: { state: async () => ({ local: true, name: "This computer" }), menu: async () => {} },
    current: { local: true, name: "This computer" },
    cloudHome: false,
    onLine: "",
    openMenu: vi.fn(),
    switchable: true,
    ...patch,
  });
  const build = (patch: Partial<Parameters<typeof profileMenuItems>[0]> = {}) => profileMenuItems({
    phone: [],
    account: "MausBot Cloud",
    simple: { tools, places: placeMenuItems(place(), { owner: null, onCloudSettings: noop }) },
    onSettings: noop, onShortcuts: noop, onAbout: noop, onAccount: noop,
    ...patch,
  });
  const groups = (items: SidebarMenuItem[]) => items.reduce<string[][]>((all, item) => {
    if (item.separatorBefore || all.length === 0) all.push([]);
    all[all.length - 1]!.push(item.key);
    return all;
  }, []);

  it("keeps Cloud as a place switch while removing paid account prompts and help rows", () => {
    const items = build();
    expect(groups(items)).toEqual([
      ["support", "settings"],
      ["automations", "team-map"],
      ["place", "switch-place", "account"],
    ]);
    expect(items.find((item) => item.key === "support")!.submenu!.map((item) => item.key)).toEqual(["shortcuts", "about"]);
    expect(items.map((item) => item.key)).not.toContain("usage");
    expect(items.map((item) => item.key)).not.toContain("update");
  });

  it("does not surface updater status through the account button", () => {
    expect(accountLabel("Ada", { automationsNeedYou: false })).toBe("Ada");
    expect(build().map((item) => item.key)).not.toContain("update");
  });

  it("adds Files once My Cloud's files are ready and Archived bots while there are any, after Team map", () => {
    const open = vi.fn();
    const items = toolMenuItems({ activeView: "files", automationsNeedYou: false, onAutomations: noop, onTeamMap: noop, onFiles: noop, archived: { count: 3, open } });
    expect(items.map((item) => [item.key, item.active, item.value])).toEqual([["automations", false, undefined], ["team-map", false, undefined], ["files", true, undefined], ["archived", undefined, "3"]]);
    items[3]!.onSelect();
    expect(open).toHaveBeenCalledOnce();
    expect(toolMenuItems({ activeView: "chat", automationsNeedYou: false, onAutomations: noop, onTeamMap: noop, archived: { count: 0, open } }).map((item) => item.key)).toEqual(["automations", "team-map"]);
  });

  it("names the account button after the person and whatever its dot is raised for", () => {
    expect(accountLabel("You", { automationsNeedYou: false })).toBe("You");
    expect(accountLabel("Ada", { automationsNeedYou: true })).toBe("Ada · Automations need you");
  });

  it("adds the move to My Cloud: a short warning once failing, shared with automations, and a quiet segment on its way", () => {
    expect(accountLabel("Omkar", { automationsNeedYou: false, move: "failed" })).toBe("Omkar · My Cloud move needs you");
    expect(accountLabel("Omkar", { automationsNeedYou: true, move: "failed" })).toBe("Omkar · My Cloud move and automations need you");
    expect(accountLabel("Omkar", { automationsNeedYou: false, move: "sending" })).toBe("Omkar · Moving to My Cloud…");
    expect(accountLabel("Omkar", { automationsNeedYou: true, move: "sending" })).toBe("Omkar · Automations need you · Moving to My Cloud…");
    expect(accountLabel("Omkar", { automationsNeedYou: false, move: "done" })).toBe("Omkar");
    expect(accountLabel("Omkar", { automationsNeedYou: true, move: "done" })).toBe("Omkar · Automations need you");
    expect(accountLabel("Omkar", { automationsNeedYou: false, move: null })).toBe("Omkar");
  });

  it("raises the avatar's dot red for a failing move like automations, and none on its way or once done", () => {
    expect(accountDot({ automationsNeedYou: false, move: "failed" })).toBe("danger");
    expect(accountDot({ automationsNeedYou: true, move: "failed" })).toBe("danger");
    expect(accountDot({ automationsNeedYou: false, move: "sending" })).toBeNull();
    expect(accountDot({ automationsNeedYou: false, move: "done" })).toBeNull();
    expect(accountDot({ automationsNeedYou: false, move: null })).toBeNull();
    expect(accountDot({ automationsNeedYou: true, move: null })).toBe("danger");
  });

  it("puts the move's row first, in its own group", () => {
    const move = [{ key: "cloud-move", label: "Try My Cloud move again", title: "My Cloud did not answer.", onSelect: noop }];
    expect(groups(build({ move }))).toEqual([
      ["cloud-move"],
      ["support", "settings"],
      ["automations", "team-map"],
      ["place", "switch-place", "account"],
    ]);
    expect(groups(build({ move: [] }))[0]).toEqual(["support", "settings"]);
  });

  it("gives a failing or moving move one row shaped like Usage and Settings: a label and an icon, no second line", () => {
    const shape = (item: SidebarMenuItem) => ({ lines: [item.subtitle, item.note].filter(Boolean).length, wrap: item.wrap === true, icon: Boolean(item.icon) });
    const failing = moveMenuItems(moveLine({ phase: "copy", failing: { error: "Some of this computer's things did not reach My Cloud." } }, "local"), { onOpen: noop, onRetry: noop, onClose: noop });
    const moving = moveMenuItems(moveLine({ phase: "copy", chats: { done: 34, total: 120 } }, "local"), { onOpen: noop, onRetry: noop, onClose: noop });
    for (const move of [failing, moving]) {
      const items = build({ move });
      expect(groups(items)[0]).toEqual(["cloud-move"]);
      const settings = items.find((item) => item.key === "settings")!;
      expect(shape(items[0]!)).toEqual(shape(settings));
    }
  });

  it("puts the move's row first in Advanced's account menu too, under its own divider", () => {
    const move = [{ key: "cloud-move", label: "Moving to My Cloud…", title: "Moving your bots to My Cloud… 34 of 120 chats", onSelect: noop }];
    expect(groups(build({ simple: undefined, move }))).toEqual([["cloud-move"], ["support", "settings"], ["account"]]);
    expect(groups(build({ simple: undefined }))).toEqual([["support", "settings"], ["account"]]);
  });

  it("draws a person instead of a question mark for someone with no name, at the trigger's own size", () => {
    const glyph = createElement("svg", { "data-glyph": "" });
    const nameless = renderToStaticMarkup(createElement(InitialsAvatar, { initials: profileInitials({}), size: 36, fallback: glyph, fontSize: 14 }));
    expect(nameless).toContain("data-glyph");
    expect(nameless).not.toContain("?");
    expect(nameless).toContain("font-size:14px");
    expect(renderToStaticMarkup(createElement(InitialsAvatar, { initials: "AL", size: 50 }))).toContain("font-size:19px");
  });

  it("marks Automations open and needing attention, and Team map plain", () => {
    expect(tools.map((item) => [item.key, item.active, item.attention])).toEqual([["automations", true, true], ["team-map", false, undefined]]);
  });

  it("ticks the current place and switches through the same native menu as the server pill", () => {
    const here = place();
    const items = placeMenuItems(here, { owner: null, onCloudSettings: noop });
    expect(items.map((item) => [item.key, item.label])).toEqual([["place", "This computer"], ["switch-place", "Switch to…"]]);
    expect(items[0]!.trailing).toBeTruthy();
    items[0]!.onSelect();
    items[1]!.onSelect();
    expect(here.openMenu).toHaveBeenCalledTimes(2);
  });

  it("names My Cloud and opens its settings when it is the window's only place, and offers nothing without either", () => {
    const onCloudSettings = vi.fn();
    const home = placeMenuItems(place({ switchable: false, cloudHome: true, onLine: "always on" }), { owner: "ada@example.test", onCloudSettings });
    expect(home.map((item) => [item.label, item.subtitle])).toEqual([["My Cloud", "always on · ada@example.test’s Cloud"]]);
    home[0]!.onSelect();
    expect(onCloudSettings).toHaveBeenCalledOnce();
    expect(placeMenuItems(place({ bridge: undefined, switchable: false }), { owner: null, onCloudSettings })).toEqual([]);
  });

  it("names a team's Cloud by the team", () => {
    const team = placeMenuItems(place({ switchable: false, cloudHome: true, onLine: "" }), { owner: null, name: "Acme Labs", onCloudSettings: noop });
    expect(team.map((item) => item.label)).toEqual(["Acme Labs"]);
  });

});
