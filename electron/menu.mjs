// Electron has no role for the macOS Preferences… item, so it is built explicitly.
import { Menu } from "electron";

/** A local environment has a folder and no address. */
const whereItLives = (environment) => (environment.kind === "local" ? environment.dataDir : new URL(environment.origin).host);

/**
 * @param {object} input
 * @param {({ id: string, name: string, origin: string } | { id: string, name: string, kind: "local", dataDir: string })[]} input.environments
 * @param {string} input.activeId  "local" or an environment id
 * @param {(id: string) => void} input.onSwitch
 * @param {() => void} input.onAddFromClipboard
 * @param {() => void} input.onConnect
 * @param {(id: string) => void} input.onForget
 * @param {() => void} input.onOpenSettings
 * @param {() => void} input.onOrganizationSignIn
 * @param {{ origin: string, onBack: () => void } | null} [input.home] My Cloud once the person's bots moved there: the
 *   menu lists only the other saved servers, with Back to My Cloud, and is absent without any.
 * @param {{ checked: boolean, onToggle: (on: boolean) => void } | null} [input.openAtLogin] Open at Login, in the app
 *   menu on macOS and the File menu elsewhere; absent when this build cannot add a login item.
 */
export function buildApplicationMenu({ environments, activeId, onSwitch, onAddFromClipboard, onConnect, onForget, onOpenSettings, onOrganizationSignIn, onAbout, sublabels = {}, home = null, openAtLogin = null }) {
  const isMac = process.platform === "darwin";
  const active = environments.find((e) => e.id === activeId) ?? null;
  const others = home ? environments.filter((e) => e.origin !== home.origin && e.kind !== "local") : [];
  const away = Boolean(active && home && active.origin !== home.origin);
  const homeServer = {
    label: "工作区",
    submenu: [
      { id: "back-to-my-cloud", label: "返回我的 Cloud", enabled: away, click: () => home?.onBack() },
      { type: "separator" },
      ...others.map((e) => ({ label: `${e.name} — ${new URL(e.origin).host}`, type: "radio", checked: e.id === activeId, click: () => onSwitch(e.id) })),
      { type: "separator" },
      { label: "通过复制的配对链接添加服务器…", click: () => onAddFromClipboard() },
      { label: away ? `移除“${active.name}”` : "移除服务器", enabled: away, click: () => away && onForget(active.id) },
    ],
  };
  const server = home ? homeServer : {
    label: "工作区",
    submenu: [
      { label: "本机", type: "radio", checked: !active, click: () => onSwitch("local") },
      ...environments.map((e) => ({
        label: `${e.name} — ${Object.hasOwn(sublabels, e.id) ? sublabels[e.id] : whereItLives(e)}`,
        type: "radio",
        checked: e.id === activeId,
        click: () => onSwitch(e.id),
      })),
      { type: "separator" },
      { id: "organization-sign-in", label: "使用组织账号登录…", click: onOrganizationSignIn },
      { label: "连接到服务器…", click: onConnect },
      { label: "通过复制的配对链接添加服务器…", click: () => onAddFromClipboard() },
      {
        label: active ? `移除“${active.name}”` : "移除服务器",
        enabled: Boolean(active),
        click: () => active && onForget(active.id),
      },
    ],
  };
  const atLogin = openAtLogin ? [{ id: "open-at-login", label: "登录时打开", type: "checkbox", checked: openAtLogin.checked, click: () => openAtLogin.onToggle(!openAtLogin.checked) }] : [];
  const template = [
    ...(isMac ? [{ label: "乖乖Ai", submenu: [{ label: "关于 乖乖Ai", click: onAbout }, { label: "设置…", accelerator: "CmdOrCtrl+,", click: () => onOpenSettings() }, ...atLogin, { type: "separator" }, { role: "hide", label: "隐藏 乖乖Ai" }, { role: "hideOthers", label: "隐藏其他应用" }, { role: "unhide", label: "显示全部" }, { type: "separator" }, { role: "quit", label: "退出 乖乖Ai" }] }] : []),
    !isMac && openAtLogin ? { label: "文件", submenu: [...atLogin, { type: "separator" }, { role: "quit", label: "退出 乖乖Ai" }] } : { role: "fileMenu", label: "文件", submenu: [{ role: "close", label: "关闭窗口" }] },
    { role: "editMenu", label: "编辑", submenu: [
      { role: "undo", label: "撤销" }, { role: "redo", label: "重做" }, { type: "separator" },
      { role: "cut", label: "剪切" }, { role: "copy", label: "复制" }, { role: "paste", label: "粘贴" },
      { role: "pasteAndMatchStyle", label: "粘贴并匹配样式" }, { role: "delete", label: "删除" }, { role: "selectAll", label: "全选" },
    ] },
    ...(home && !others.length ? [] : [server]),
    { role: "viewMenu", label: "显示", submenu: [
      { role: "reload", label: "重新载入" }, { role: "forceReload", label: "强制重新载入" }, { role: "toggleDevTools", label: "开发者工具" },
      { type: "separator" }, { role: "resetZoom", label: "实际大小" }, { role: "zoomIn", label: "放大" }, { role: "zoomOut", label: "缩小" },
      { type: "separator" }, { role: "togglefullscreen", label: "切换全屏" },
    ] },
    { role: "windowMenu", label: "窗口", submenu: [
      { role: "minimize", label: "最小化" }, { role: "zoom", label: "缩放窗口" }, { type: "separator" }, { role: "front", label: "全部置于最前" },
    ] },
  ];
  return Menu.buildFromTemplate(template);
}
