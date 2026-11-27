// Retain the Windows notification-area identity across app restarts.
export function createSystemTray({ Tray, Menu, nativeImage, iconPath, getWindow, onQuit }) {
  const tray = new Tray(nativeImage.createFromPath(iconPath).resize({ width: 20, height: 20 }),
    "889af657-21b5-4ec9-b5d0-cb798cbdfd30");
  let hidden = false;
  const show = () => {
    const win = getWindow();
    if (!win || win.isDestroyed()) return false;
    hidden = false;
    win.setSkipTaskbar(false);
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    return true;
  };
  let update = null;
  const refreshMenu = () => tray.setContextMenu(Menu.buildFromTemplate([
    { label: "打开乖乖AI", click: show },
    update ? { label: update.label, click: show } : { type: "separator" },
    { label: "退出乖乖AI", click: onQuit },
  ]));
  tray.setToolTip("乖乖AI");
  refreshMenu();
  tray.on("click", show);
  tray.on("double-click", show);
  return {
    show,
    hide(win) { hidden = true; win.setSkipTaskbar(true); win.hide(); },
    isHidden() { return hidden; },
    windowShown(win) { hidden = false; win.setSkipTaskbar(false); },
    setUpdate(state) {
      const version = typeof state?.version === "string" ? state.version : null;
      const visible = version && ["available", "downloaded"].includes(state?.status);
      update = visible ? { label: `有新版本可用 · ${version}` } : null;
      tray.setToolTip(update ? `乖乖AI · ${update.label}` : "乖乖AI");
      refreshMenu();
    },
    destroy() { if (!tray.isDestroyed()) tray.destroy(); },
  };
}
