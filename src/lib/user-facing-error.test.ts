import { describe, expect, it } from "vitest";
import { localizeUserFacingError } from "./user-facing-error";

describe("localizeUserFacingError", () => {
  it("translates MCP startup failures", () => {
    expect(localizeUserFacingError("MCP server could not start; check its command and installation")).toContain("MCP 服务启动失败");
  });
  it("translates uncertain timeouts without suggesting blind retry", () => {
    expect(localizeUserFacingError("MCP request timed out; execution outcome may be uncertain")).toContain("执行结果可能未知");
  });
  it("translates startup timeouts without implying that a tool ran", () => {
    expect(localizeUserFacingError("MCP server startup timed out; no tool operation was dispatched")).toContain("尚未执行工具操作");
  });
  it("translates coordination failures", () => {
    expect(localizeUserFacingError("agents_coordinate_bots failed")).toContain("机器人协作分派未确认成功");
  });
  it("translates missing API key setup guidance", () => {
    expect(localizeUserFacingError("No API key — open Settings → API keys.")).toBe("未设置 API 密钥，请打开“设置 → API 密钥”完成配置。");
    expect(localizeUserFacingError("No SimpleAPI API key — open Settings → API keys.")).toContain("配置SimpleAPI");
  });
  it("translates upstream 503 failures without hiding the cause", () => {
    expect(localizeUserFacingError("upstream HTTP 503: Service temporarily unavailable")).toContain("上游 AI 服务暂时不可用（503）");
  });
});
