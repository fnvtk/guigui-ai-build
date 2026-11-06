import type { SendKey } from "./send-key";
import { activeLocale } from "./i18n";

export interface ShortcutItem {
  id: string;
  description: string;
  macKeys: string[];
  winKeys: string[];
}

export interface ShortcutGroup {
  category: string;
  items: ShortcutItem[];
}

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  {
    category: "Navigation",
    items: [
      {
        id: "command-palette",
        description: "Open command palette (switcher & transcript search)",
        macKeys: ["⌘", "K"],
        winKeys: ["Ctrl", "K"],
      },
      {
        id: "new-bot",
        description: "Create a new bot",
        macKeys: ["⌘", "N"],
        winKeys: ["Ctrl", "N"],
      },
      {
        id: "jump-bot",
        description: "Jump to bot 1–9 in the roster",
        macKeys: ["⌘", "1–9"],
        winKeys: ["Ctrl", "1–9"],
      },
      {
        id: "toggle-sidebar",
        description: "Collapse or expand the sidebar",
        macKeys: ["⌘", "\\"],
        winKeys: ["Ctrl", "\\"],
      },
      {
        id: "switch-bot",
        description: "Switch to previous / next bot",
        macKeys: ["⌘", "⇧", "[ / ]"],
        winKeys: ["Ctrl", "Shift", "[ / ]"],
      },
      {
        id: "find-conversation",
        description: "Find in conversation",
        macKeys: ["⌘", "F"],
        winKeys: ["Ctrl", "F"],
      },
    ],
  },
  {
    category: "Chat & Composer",
    items: [
      {
        id: "send-message",
        description: "Send message",
        macKeys: ["Return"],
        winKeys: ["Enter"],
      },
      {
        id: "new-line",
        description: "Insert new line without sending",
        macKeys: ["⇧", "Return"],
        winKeys: ["Shift", "Enter"],
      },
      {
        id: "send-follow-up",
        description: "While a bot works: queue instead of steering, or the other way round",
        macKeys: ["⌘", "Return"],
        winKeys: ["Ctrl", "Enter"],
      },
      {
        id: "edit-last-message",
        description: "Edit last message (when composer is empty)",
        macKeys: ["↑"],
        winKeys: ["↑"],
      },
      {
        id: "close-panel",
        description: "Close active drawer, modal, or find bar",
        macKeys: ["Esc"],
        winKeys: ["Esc"],
      },
      {
        id: "shortcuts-cheat-sheet",
        description: "Show keyboard shortcuts cheat sheet",
        macKeys: ["⌘", "/"],
        winKeys: ["Ctrl", "/"],
      },
    ],
  },
  {
    category: "Calls",
    items: [
      {
        id: "live-call-mute",
        description: "Mute or unmute a Live call",
        macKeys: ["⌘", "⇧", "M"],
        winKeys: ["Ctrl", "Shift", "M"],
      },
      {
        id: "live-call-hang-up",
        description: "Hang up a Live call",
        macKeys: ["⌘", "⇧", "H"],
        winKeys: ["Ctrl", "Shift", "H"],
      },
    ],
  },
  {
    category: "Management & Groups",
    items: [
      {
        id: "save-bulletin",
        description: "Save group instruction changes",
        macKeys: ["⌘", "Return"],
        winKeys: ["Ctrl", "Enter"],
      },
      {
        id: "reorder-section",
        description: "Reorder sidebar sections (focus a section heading)",
        macKeys: ["⌥", "↑ / ↓"],
        winKeys: ["Alt", "↑ / ↓"],
      },
    ],
  },
];

type Keys = Pick<ShortcutItem, "macKeys" | "winKeys">;
const ENTER: Keys = { macKeys: ["Return"], winKeys: ["Enter"] };
const SHIFT_ENTER: Keys = { macKeys: ["⇧", "Return"], winKeys: ["Shift", "Enter"] };
const MOD_ENTER: Keys = { macKeys: ["⌘", "Return"], winKeys: ["Ctrl", "Enter"] };
const SEND_ROWS: Record<Exclude<SendKey, "enter">, [Keys, Keys, Keys]> = {
  "shift-enter": [SHIFT_ENTER, ENTER, MOD_ENTER],
  "mod-enter": [MOD_ENTER, ENTER, { macKeys: ["⌘", "⇧", "Return"], winKeys: ["Ctrl", "Shift", "Enter"] }],
};

export function shortcutGroupsFor(sendKey: SendKey): readonly ShortcutGroup[] {
  let groups: readonly ShortcutGroup[] = SHORTCUT_GROUPS;
  if (sendKey !== "enter") {
    const [send, newLine, followUp] = SEND_ROWS[sendKey];
    groups = SHORTCUT_GROUPS.map((group) => ({
      ...group,
      items: group.items.map((item) =>
        item.id === "send-message" ? { ...item, ...send }
          : item.id === "new-line" ? { ...item, ...newLine }
            : item.id === "send-follow-up" ? { ...item, ...followUp }
              : item),
    }));
  }
  if (!activeLocale().startsWith("zh")) return groups;
  const categories = ["导航", "聊天与输入", "通话", "管理与群组"];
  const descriptions: Record<string, string> = {
    "command-palette": "打开命令面板（切换器与对话搜索）",
    "new-bot": "新建机器人",
    "jump-bot": "跳转到列表中的第 1–9 个机器人",
    "toggle-sidebar": "收起或展开侧边栏",
    "switch-bot": "切换到上一个或下一个机器人",
    "find-conversation": "在当前对话中查找",
    "send-message": "发送消息",
    "new-line": "换行但不发送",
    "send-follow-up": "机器人工作时：排队发送后续消息，或切换为直接调整当前任务",
    "edit-last-message": "编辑上一条消息（输入框为空时）",
    "close-panel": "关闭当前抽屉、弹窗或查找栏",
    "shortcuts-cheat-sheet": "显示键盘快捷键",
    "live-call-mute": "静音或取消静音",
    "live-call-hang-up": "挂断实时通话",
    "save-bulletin": "保存群组说明变更",
    "reorder-section": "调整侧边栏分区顺序（先聚焦分区标题）",
  };
  return groups.map((group, index) => ({
    ...group,
    category: categories[index] ?? group.category,
    items: group.items.map((item) => ({ ...item, description: descriptions[item.id] ?? item.description })),
  }));
}

export function isSidebarToggle(event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey" | "defaultPrevented">): boolean {
  return !event.defaultPrevented && event.key === "\\" && (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey;
}

export function shouldOpenKeyboardShortcuts(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.isComposing || event.altKey) return false;
  const helpKey = event.key === "?" && !event.metaKey && !event.ctrlKey;
  const helpChord = event.key === "/" && (event.metaKey || event.ctrlKey) && !event.shiftKey;
  if (!helpKey && !helpChord) return false;
  const target = event.target;
  return !(target instanceof HTMLElement && (
    target.isContentEditable || target.closest("input, textarea, select, dialog, [role=dialog]")
  ));
}

export function isMacPlatform(): boolean {
  if (typeof window !== "undefined" && window.ogb?.platform) {
    return window.ogb.platform === "darwin";
  }
  if (typeof navigator !== "undefined" && navigator.userAgent) {
    return navigator.userAgent.includes("Mac");
  }
  return true;
}

export function shortcutKeysForPlatform(
  item: ShortcutItem,
  isMac: boolean = isMacPlatform(),
): string[] {
  return isMac ? item.macKeys : item.winKeys;
}

export function filterShortcutGroups(
  groups: readonly ShortcutGroup[],
  query: string,
  isMac: boolean = isMacPlatform(),
): ShortcutGroup[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [...groups];

  return groups
    .map((group) => {
      const filteredItems = group.items.filter((item) => {
        const keys = shortcutKeysForPlatform(item, isMac).join(" ").toLowerCase();
        return (
          item.description.toLowerCase().includes(normalized) ||
          group.category.toLowerCase().includes(normalized) ||
          keys.includes(normalized)
        );
      });
      return { ...group, items: filteredItems };
    })
    .filter((group) => group.items.length > 0);
}
