import type { WechatNativeConfig } from "../guai-billing-wechat.ts";
import { PASS, type RouteHandler } from "./table.ts";

export type GuaiWechatPublicConfig = Omit<WechatNativeConfig, "apiV3Key">;
const PUBLIC_FIELDS = ["appId", "merchantId", "merchantCertificatePath", "privateKeyPath", "platformCertificatePath", "platformSerialNo", "notifyUrl"] as const;
type Readiness = { ready: boolean; missingFields: string[]; error?: string };

export function createGuaiWechatConfigRoutes(deps: {
  config(): WechatNativeConfig;
  save(patch: GuaiWechatPublicConfig): Promise<void> | void;
  readiness(config: WechatNativeConfig): Promise<Readiness>;
  importCredentials(): Promise<void>;
}): RouteHandler {
  const publicState = async () => {
    const config = deps.config();
    const state = await deps.readiness(config);
    const publicFields = Object.fromEntries(PUBLIC_FIELDS.map(field => [field, config[field] ?? ""]));
    return { ...publicFields, enabled: config.enabled === true, apiV3KeyConfigured: !!config.apiV3Key,
      ready: state.ready, missingFields: [...state.missingFields.map(field => field.replace(/^wechat([A-Z])/, (_, first: string) => first.toLowerCase())), ...(state.error ? [state.error] : [])] };
  };
  return async ({ path, method, req, res, json, readBody }) => {
    if (!path.startsWith("/api/guai-billing/wechat/")) return PASS;
    if (path === "/api/guai-billing/wechat/config" && method === "GET") return json(res, 200, await publicState());
    if ((path === "/api/guai-billing/wechat/config" && method === "PUT") || (path === "/api/guai-billing/wechat/import" && method === "POST")) {
      let raw: unknown;
      try { raw = await readBody(req); } catch { return json(res, 400, { error: "请求内容无效" }); }
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return json(res, 400, { error: "请求内容必须是对象" });
      const body = raw as Record<string, unknown>;
      if (path.endsWith("/import")) {
        if (Object.keys(body).length) return json(res, 400, { error: "证书导入不接受其他路径或参数" });
        try { await deps.importCredentials(); return json(res, 200, { imported: true }); }
        catch (error) { return json(res, 503, { error: error instanceof Error ? error.message : "本机证书导入失败" }); }
      }
      if (Object.keys(body).some(field => field !== "enabled" && !(PUBLIC_FIELDS as readonly string[]).includes(field))) return json(res, 400, { error: "只允许公开商户配置字段，密钥请使用桌面安全存储" });
      if (body.enabled !== undefined && typeof body.enabled !== "boolean") return json(res, 400, { error: "启用状态无效" });
      const patch: GuaiWechatPublicConfig = {};
      for (const field of PUBLIC_FIELDS) {
        if (body[field] === undefined) continue;
        // Reject control characters at this external configuration boundary.
        // eslint-disable-next-line no-control-regex
        if (typeof body[field] !== "string" || body[field].length > 2048 || /[\u0000-\u001f\u007f]/.test(body[field])) return json(res, 400, { error: "商户配置字段格式无效" });
        patch[field] = body[field].trim();
      }
      if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
      if (patch.enabled === true) {
        const state = await deps.readiness({ ...deps.config(), ...patch });
        if (!state.ready) return json(res, 422, { error: state.error ?? "请先补齐并验证商户配置，再启用微信收款", missingFields: state.missingFields });
      }
      await deps.save(patch);
      return json(res, 200, await publicState());
    }
    return PASS;
  };
}
