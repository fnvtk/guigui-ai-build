import { activeLocale, t } from "./i18n";

export type MacCuaPermission = "screen" | "accessibility";

export function missingMacCuaPermissions(reason: unknown): MacCuaPermission[] {
  if (typeof reason !== "string" || reason.length > 2_000) return [];
  const missingList = reason.match(/(Accessibility(?: and Screen Recording)?|Screen Recording(?: and Accessibility)?) required\b/i)?.[1];
  if (!missingList) return [];
  const missing: MacCuaPermission[] = [];
  if (/Screen Recording/i.test(missingList)) missing.push("screen");
  if (/Accessibility/i.test(missingList)) missing.push("accessibility");
  return missing;
}

export function macCuaPermissionMessage(permissions: MacCuaPermission[]): string | null {
  if (!permissions.length) return null;
  if (permissions.length > 1) return t("computer.mac.permission.requiredBoth");
  return t("computer.mac.permission.requiredOne", {
    permission: activeLocale().startsWith("zh")
      ? (permissions[0] === "screen" ? "屏幕录制" : "辅助功能")
      : (permissions[0] === "screen" ? "Screen Recording" : "Accessibility"),
  });
}

/** Translate the driver's diagnostic without changing the persisted failure or its outcome. */
export function macCuaDriverDetail(reason: string): string {
  const branded = reason.replace(/OpenMausBot|MausBot/g, "乖乖Ai");
  if (!activeLocale().startsWith("zh")) return branded;
  return branded
    .replace(/General already has a Chief of Staff\. Move or change this department's Chief before deleting it/g, "通用部门已有总协调机器人。请先移动或更换当前部门的总协调机器人，再删除该部门。")
    .replace(/Stopped repeated invalid calls to ([^:]+):/g, "工具参数多次不符合要求（$1）：")
    .replace(/Tool arguments do not match the advertised input schema:/g, "参数不符合工具说明：")
    .replace(/must have required property '([^']+)'/g, "缺少必填字段“$1”")
    .replace(/No operation was dispatched for these invalid calls\./g, "这些调用未执行任何操作。")
    .replace(/Stopped because the tool calls? (.+?) failed\./g, "工具调用未完成：$1。")
    .replace(/The bot's reply isn't proof the work was done; the failed step shows the error\./g, "机器人回复不能代替完成凭据，请查看失败步骤的具体结果。")
    .replace(/agents_session_search/g, "历史对话查询")
    .replace(/agents_coordinate_bots/g, "机器人协作分派")
    .replace(/agents_trigger_info/g, "定时任务查询")
    .replace(/browser_agent_browser_wait_for_text/g, "等待页面文字")
    .replace(/agents_select_computer/g, "选择工作电脑")
    .replace(/agents_skill_manage/g, "管理技能")
    .replace(/agents_propose_profile/g, "更新机器人资料")
    .replace(/” and “/g, "”和“")
    .replace(/embedded host failed:/gi, "内置电脑驱动启动失败：")
    .replace(/Accessibility and Screen Recording required/gi, "缺少辅助功能和屏幕录制授权")
    .replace(/Screen Recording and Accessibility required/gi, "缺少屏幕录制和辅助功能授权")
    .replace(/Accessibility required/gi, "缺少辅助功能授权")
    .replace(/Screen Recording required/gi, "缺少屏幕录制授权")
    .replace(/grant access in System Settings and restart 乖乖Ai/gi, "请在系统设置中重新关联当前应用的授权，然后重启乖乖Ai")
    .replace(/乖乖Ai can't use this computer yet[ —-]*/gi, "乖乖Ai暂时无法使用此电脑：")
    .replace(/Relaunch 乖乖Ai after granting the missing macOS permission\./gi, "补齐系统授权后，请重新启动乖乖Ai。");
}

/** Localize only the app-generated retry envelope; keep the original stored message intact. */
export function localizeRetryNotice(text: string): string {
  if (!activeLocale().startsWith("zh") || !text.startsWith("[Retry requested by ")) return text;
  return text
    .replace(/^\[Retry requested by (.+?), your Chief of Staff, after this thread's last run stopped\./, "[上次任务中断后，总协调机器人$1发起了重试。")
    .replace(/ Note from ([^:]+): /, " $1的补充说明：")
    .replace(/Continue the request above from where it stopped and finish it\. If the same problem comes back, say exactly what is blocking and stop\./, "请从上次中断处继续完成上述请求；若再次遇到相同问题，请明确说明阻塞原因并停止。");
}
