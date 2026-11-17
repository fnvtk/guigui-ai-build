const EXACT_MESSAGES: Record<string, string> = {
  "MCP server could not start; check its command and installation": "MCP 服务启动失败，请检查服务命令和安装；本次不会重复盲目重试。",
  "MCP server exited before the session closed": "MCP 服务在会话结束前退出了，请检查服务日志后再重试。",
  "MCP server input closed": "MCP 服务输入通道已关闭，请检查服务是否正常运行。",
  "Service temporarily unavailable": "服务暂时不可用，请检查服务状态或稍后重试。",
};

export function localizeUserFacingError(raw: string): string {
  const text = raw.trim();
  if (!text) return text;
  const exact = EXACT_MESSAGES[text];
  if (exact) return exact;
  if (/^MCP server startup timed out\b/i.test(text) || /^MCP startup timed out\b/i.test(text)) return "MCP 服务启动超时，尚未执行工具操作，请检查服务状态后重试。";
  if (/^MCP request timed out\b/i.test(text)) return "MCP 请求超时，执行结果可能未知。请先查看当前操作状态或回执，确认没有产生副作用后再重试。";
  if (/^No API key\s*[—-]\s*open Settings\s*[→>]\s*API keys\.?$/i.test(text)) return "未设置 API 密钥，请打开“设置 → API 密钥”完成配置。";
  if (/^No (.+?) API key\s*[—-]\s*open Settings\s*[→>]\s*API keys\.?$/i.test(text)) {
    return `未设置 API 密钥，请打开“设置 → API 密钥”配置${text.match(/^No (.+?) API key/i)?.[1] ?? "对应服务"}。`;
  }
  if (/\b(?:upstream|上游) HTTP 503\b/i.test(text) || /service temporarily unavailable/i.test(text)) {
    return "上游 AI 服务暂时不可用（503），系统已自动重试；请稍后再试，若持续出现请检查服务端状态。";
  }
  if (/coordinate_bots could not confirm dispatch/i.test(text) || /agents_coordinate_bots/i.test(text) || /机器人协作分派/.test(text)) return "机器人协作分派未确认成功。请先核对任务状态、回执或现有分派，再用可达的成员 ID 重试，避免重复派单。";
  if (/the bot's reply isn't proof/i.test(text)) return "机器人回复不能替代执行凭据，请查看失败步骤的具体结果。";
  if (/^MCP server could not start\b/i.test(text)) return `MCP 服务启动失败：${text.slice("MCP server could not start".length).replace(/^[:;\s]+/, "") || "请检查服务命令和安装。"}`;
  return text;
}
