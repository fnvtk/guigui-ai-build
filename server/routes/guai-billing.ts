import type { GuaiBillingConfig, GuaiBillingError } from "../guai-billing.ts";
import type { GuaiBillingBalance, GuaiCheckoutOrder } from "../../shared/guai-billing.ts";
import type { ServerResponse } from "node:http";
import type { json as jsonFn } from "../harness/http.ts";
import { createGuaiBilling } from "../guai-billing.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface GuaiBillingRouteService {
  catalog(): ReturnType<ReturnType<typeof createGuaiBilling>["catalog"]>;
  checkout(customerId: string | null, skuId: unknown, idempotencyKey: unknown): Promise<GuaiCheckoutOrder>;
  order(customerId: string | null, orderId: string): Promise<GuaiCheckoutOrder>;
  balance(customerId: string | null): Promise<GuaiBillingBalance>;
}

function publicConfig(config: GuaiBillingConfig) {
  return {
    localModulePath: config.localModulePath ?? "",
    localModuleError: config.localModuleError ?? "",
    localModuleConnected: config.localModuleConnected === true,
  };
}

export function createGuaiBillingRoutes(deps: {
  billing: GuaiBillingRouteService;
  getConfig?: () => GuaiBillingConfig;
  /** Uses the host's fixed authorized module path; never accepts a client path. */
  connectLocal?: () => Promise<void>;
  /** Resolve identity only from the authenticated host session; never from request JSON. */
  customerId(auth: Parameters<RouteHandler>[0]["auth"]): string | null;
}): RouteHandler {
  return async ({ path, method, auth, req, res, json, readBody }) => {
    if (path === "/api/guai-billing/config" && method === "GET") {
      if (!deps.getConfig) return json(res, 404, { error: "支付配置管理未接入" });
      return json(res, 200, publicConfig(deps.getConfig()));
    }
    if (path === "/api/guai-billing/local/connect" && method === "POST") {
      if (!deps.connectLocal) return json(res, 503, { error: "本地收费模块宿主未接入" });
      let body: unknown;
      try { body = await readBody(req); } catch (error) { const status = (error as { status?: number }).status; return json(res, status === 413 ? 413 : 400, { error: "请求内容无效" }); }
      if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 0) return json(res, 400, { error: "连接模块请求不接受路径或其他参数" });
      try { await deps.connectLocal(); return json(res, 200, { connected: true }); }
      catch { return json(res, 503, { connected: false, error: "本地收费模块启动失败，请查看连接状态" }); }
    }
    if (method === "GET" && path === "/api/guai-billing/catalog") {
      try { return json(res, 200, await deps.billing.catalog()); }
      catch (error) { return billingError(res, json, error); }
    }
    if (method === "GET" && path === "/api/guai-billing/balance") {
      try { return json(res, 200, await deps.billing.balance(deps.customerId(auth))); }
      catch (error) { return billingError(res, json, error); }
    }
    if (method === "POST" && path === "/api/guai-billing/checkout") {
      let body: unknown;
      try { body = await readBody(req); } catch (error) { const status = (error as { status?: number }).status; return json(res, status === 413 ? 413 : 400, { error: "请求内容无效" }); }
      const value = body !== null && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
      if ("customerId" in value || Object.keys(value).some((key) => !["skuId", "idempotencyKey"].includes(key))) return json(res, 400, { error: "仅接受 skuId 和 idempotencyKey" });
      try { return json(res, 200, await deps.billing.checkout(deps.customerId(auth), value.skuId, value.idempotencyKey)); }
      catch (error) { return billingError(res, json, error); }
    }
    const match = method === "GET" ? path.match(/^\/api\/guai-billing\/checkout\/([\w.-]+)$/) : null;
    if (match) {
      try { return json(res, 200, await deps.billing.order(deps.customerId(auth), match[1]!)); }
      catch (error) { return billingError(res, json, error); }
    }
    return PASS;
  };
}

function billingError(res: ServerResponse, json: typeof jsonFn, error: unknown) {
  const value = error as Partial<GuaiBillingError>;
  const status = typeof value.status === "number" && value.status >= 400 && value.status <= 599 ? value.status : 502;
  return json(res, status, { error: typeof value.message === "string" ? value.message : "支付服务暂不可用" });
}
