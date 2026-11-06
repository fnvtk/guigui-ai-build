import { setLocale } from "./i18n";
import { describe, expect, it } from "vitest";
import { localizeRetryNotice, macCuaDriverDetail, macCuaPermissionMessage, missingMacCuaPermissions } from "./mac-cua-permissions";

describe("macOS CUA permission recovery", () => {
  it("names only the grants the host reported missing", () => {
    expect(missingMacCuaPermissions("embedded host failed: Screen Recording required; restart OpenMausBot")).toEqual(["screen"]);
    expect(missingMacCuaPermissions("Accessibility and Screen Recording required")).toEqual(["screen", "accessibility"]);
    expect(macCuaPermissionMessage(["accessibility"])).toContain("Accessibility is required for 乖乖Ai");
    expect(macCuaPermissionMessage(["screen"])).toContain("relaunch 乖乖Ai");
  });

  it("does not diagnose missing or malformed status as a grant failure", () => {
    expect(missingMacCuaPermissions(null)).toEqual([]);
    expect(missingMacCuaPermissions({ reason: "Screen Recording required" })).toEqual([]);
    expect(missingMacCuaPermissions("Screen Recording available")).toEqual([]);
    expect(missingMacCuaPermissions("Screen Recording granted; Accessibility required")).toEqual(["accessibility"]);
    expect(macCuaPermissionMessage([])).toBeNull();
  });
});

it("translates driver details while preserving unknown diagnostic evidence", () => {
  setLocale("zh");
  expect(macCuaPermissionMessage(["screen"])).toContain("屏幕录制");
  expect(macCuaPermissionMessage(["accessibility"])).toContain("辅助功能");
  const detail = macCuaDriverDetail("embedded host failed: Accessibility and Screen Recording required; grant access in System Settings and restart OpenMausBot; error E42");
  expect(detail).toContain("内置电脑驱动启动失败");
  expect(detail).toContain("缺少辅助功能和屏幕录制授权");
  expect(detail).toContain("error E42");
  expect(detail).not.toContain("OpenMausBot");
  setLocale("en");
});

it("localizes the reported tool failure and retry notice without changing ordinary text", () => {
  setLocale("zh");
  const failure = macCuaDriverDetail('Stopped because the tool calls “agents_session_search” and “agents_coordinate_bots” failed.');
  expect(failure).toBe('工具调用未完成：“历史对话查询”和“机器人协作分派”。');
  const original = "[Retry requested by 乖乖, your Chief of Staff, after this thread's last run stopped. Note from 乖乖: 请核对已有任务。 Continue the request above from where it stopped and finish it. If the same problem comes back, say exactly what is blocking and stop.]";
  const localized = localizeRetryNotice(original);
  expect(localized).toContain("总协调机器人乖乖发起了重试");
  expect(localized).toContain("请核对已有任务");
  expect(localized).not.toContain("Continue the request");
  expect(localizeRetryNotice("普通消息 Retry requested by test")).toBe("普通消息 Retry requested by test");
  expect(macCuaDriverDetail("General already has a Chief of Staff. Move or change this department's Chief before deleting it")).toContain("通用部门已有总协调机器人");
  setLocale("en");
  expect(localizeRetryNotice(original)).toBe(original);
});
