import { describe, expect, it } from "vitest";
import { localizeUserFacingError } from "./user-facing-error";

describe("localizeUserFacingError", () => {
  it("translates MCP startup failures", () => {
    expect(localizeUserFacingError("MCP server could not start; check its command and installation")).toContain("MCP 服务启动失败");
  });
  it("translates uncertain timeouts without suggesting blind retry", () => {
    expect(localizeUserFacingError("MCP request timed out; execution outcome may be uncertain")).toContain("执行结果可能未知");
  });
  it("translates coordination failures", () => {
    expect(localizeUserFacingError("agents_coordinate_bots failed")).toContain("机器人协作分派未确认成功");
  });
});
