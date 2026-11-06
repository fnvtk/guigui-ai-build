import type { GuaiBillingBalance, GuaiBillingCatalog, GuaiBillingPlan, GuaiCheckoutOrder, GuaiCheckoutStatus } from "../shared/guai-billing.ts";

export interface GuaiBillingConfig {
  apiUrl?: string;
  apiToken?: string;
  statusPath?: string;
  balancePath?: string;
  localModulePath?: string;
  localModuleError?: string;
  localModuleConnected?: boolean;
  referenceSource?: { file: string; url: string; checkedAt: string; scope: string };
  baseUrl?: string;
  appToken?: string;
  returnTargetId?: string;
  catalogPath?: string;
  orderPathTemplate?: string;
  plans?: GuaiBillingPlan[];
}

export interface GuaiBillingOrderRecord {
  customerId: string;
  idempotencyKey: string;
  requestHash: string;
  orderId: string;
  skuId: string;
  status: GuaiCheckoutStatus;
  checkoutUrl?: string;
}

/** The host must back this interface with an atomic, durable store before production use. */
export interface GuaiBillingOrderStore {
  get(customerId: string, orderId: string): Promise<GuaiBillingOrderRecord | null>;
  getByIdempotencyKey(customerId: string, key: string): Promise<GuaiBillingOrderRecord | null>;
  createIfAbsent(record: GuaiBillingOrderRecord): Promise<"created" | "exists">;
  update(record: GuaiBillingOrderRecord): Promise<void>;
}

export interface GuaiBillingDeps {
  config(): GuaiBillingConfig;
  orders: GuaiBillingOrderStore;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export function guaiBillingApiUrl(config: GuaiBillingConfig): string | undefined { return config.apiUrl ?? config.baseUrl; }
export function guaiBillingApiToken(config: GuaiBillingConfig): string | undefined { return config.apiToken ?? config.appToken; }
export function guaiBillingStatusPath(config: GuaiBillingConfig): string | undefined { return config.statusPath ?? config.orderPathTemplate; }

export class GuaiBillingError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

const KEY_RE = /^[\x21-\x7e]{16,160}$/;
const SKU_RE = /^[\w.-]{1,120}$/;
const ORDER_RE = /^[\w.-]{1,200}$/;
const STATUSES = new Set<GuaiCheckoutStatus>(["created", "pending", "paid", "failed", "expired", "unknown"]);

function allowedBaseUrl(raw: string | undefined): URL | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.username || url.password || url.search || url.hash) return null;
    if (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return url;
  } catch { return null; }
  return null;
}

export function isGuaiBillingUrlAllowed(raw: string): boolean { return allowedBaseUrl(raw) !== null; }
export function isGuaiBillingPathAllowed(path: string): boolean {
  if (!path.startsWith("/") || path.startsWith("//")) return false;
  try { return new URL(path, "https://billing.invalid").origin === "https://billing.invalid"; } catch { return false; }
}

function endpoint(base: URL, path: string): URL {
  if (!path.startsWith("/") || path.startsWith("//")) throw new GuaiBillingError(503, "支付服务接口路径配置无效");
  const url = new URL(path, base);
  if (url.origin !== base.origin) throw new GuaiBillingError(503, "支付服务接口路径配置无效");
  return url;
}

function recordPayload(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function validPlan(value: unknown): value is GuaiBillingPlan {
  const plan = recordPayload(value);
  return !!plan && typeof plan.skuId === "string" && SKU_RE.test(plan.skuId) && typeof plan.name === "string" &&
    (plan.description === undefined || typeof plan.description === "string") &&
    (plan.displayPrice === undefined || typeof plan.displayPrice === "string") &&
    (plan.availability === undefined || plan.availability === "available" || plan.availability === "reference_only") &&
    (plan.checkoutEnabled === undefined || typeof plan.checkoutEnabled === "boolean");
}

function parseCatalog(value: unknown): { plans: GuaiBillingPlan[]; paymentChannelsLiveVerified: boolean } | null {
  const root = recordPayload(value);
  const data = recordPayload(root?.data) ?? root;
  const plans = data?.plans ?? data?.items ?? data?.catalog;
  if (!Array.isArray(plans) || !plans.every(validPlan)) return null;
  return {
    plans: plans.map((plan) => ({ ...plan,
      availability: data?.paymentChannelsLiveVerified === true && plan.referenceOnly !== true ? "available" : "reference_only",
      checkoutEnabled: data?.paymentChannelsLiveVerified === true && plan.referenceOnly !== true && plan.checkoutEnabled !== false,
    })),
    paymentChannelsLiveVerified: data?.paymentChannelsLiveVerified === true,
  };
}

function responseOrder(value: unknown): { orderId: string; status: GuaiCheckoutStatus; checkoutUrl?: string } | null {
  const root = recordPayload(value);
  const data = recordPayload(root?.data) ?? root;
  const orderId = data?.orderId ?? data?.id;
  const status = data?.status;
  const checkoutUrl = data?.checkoutUrl;
  if (root?.ok === false || typeof orderId !== "string" || !ORDER_RE.test(orderId) || typeof status !== "string" || !STATUSES.has(status as GuaiCheckoutStatus)) return null;
  if (checkoutUrl !== undefined) {
    if (typeof checkoutUrl !== "string") return null;
    let url: URL;
    try { url = new URL(checkoutUrl); } catch { return null; }
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) return null;
    return { orderId, status: status as GuaiCheckoutStatus, checkoutUrl: url.toString() };
  }
  return { orderId, status: status as GuaiCheckoutStatus };
}

export function createGuaiBilling(deps: GuaiBillingDeps) {
  const doFetch = deps.fetch ?? fetch;
  const readiness = (config: GuaiBillingConfig) => {
    const base = allowedBaseUrl(guaiBillingApiUrl(config));
    const token = typeof guaiBillingApiToken(config) === "string" && guaiBillingApiToken(config)!.trim().length > 0;
    const checkoutReady = !!base && token && typeof config.returnTargetId === "string" && config.returnTargetId.length > 0;
    return { base, checkoutReady, configured: !!base || token || !!config.returnTargetId };
  };
  const request = async (url: URL, token: string, init: RequestInit = {}): Promise<unknown> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 8_000);
    try {
      const response = await doFetch(url, { ...init, headers: { authorization: `Bearer ${token}`, accept: "application/json", ...init.headers }, redirect: "error", signal: controller.signal });
      const text = await response.text();
      let body: unknown = null;
      try { body = text ? JSON.parse(text) : null; } catch { throw new GuaiBillingError(502, "支付服务返回了无法识别的数据"); }
      if (!response.ok) {
        const root = recordPayload(body);
        const code = typeof root?.errorCode === "string" ? root.errorCode : "";
        throw new GuaiBillingError(response.status >= 400 && response.status <= 599 ? response.status : 502, code ? `支付服务拒绝请求（${code}）` : "支付服务暂不可用");
      }
      return body;
    } catch (error) {
      if (error instanceof GuaiBillingError) throw error;
      throw new GuaiBillingError(503, error instanceof Error && error.name === "AbortError" ? "支付服务请求超时" : "支付服务暂不可用");
    } finally { clearTimeout(timer); }
  };
  const providerCatalog = async (config: GuaiBillingConfig, base: URL, token: string): Promise<{ plans: GuaiBillingPlan[]; paymentChannelsLiveVerified: boolean } | null> => {
    if (!config.catalogPath) return null;
    const body = await request(endpoint(base, config.catalogPath), token);
    const catalog = parseCatalog(body);
    if (!catalog) throw new GuaiBillingError(502, "支付服务套餐目录格式无效");
    return catalog;
  };

  return {
    async catalog(): Promise<GuaiBillingCatalog> {
      const config = deps.config();
      const state = readiness(config);
      const token = guaiBillingApiToken(config);
      const message = !state.base || !token ? "支付服务未配置" : !config.returnTargetId ? "支付返回目标未配置" : undefined;
      if (state.base && token && config.catalogPath) {
        const catalog = await providerCatalog(config, state.base, token);
        if (!catalog) throw new GuaiBillingError(502, "支付服务套餐目录格式无效");
        const referenceOnly = !catalog.paymentChannelsLiveVerified || catalog.plans.some((plan) => plan.referenceOnly === true);
        return { configured: state.configured, catalogConnected: true, catalogStatus: referenceOnly ? "reference_only" : "connected", paymentChannelsLiveVerified: catalog.paymentChannelsLiveVerified, checkoutReady: state.checkoutReady && catalog.paymentChannelsLiveVerified && !referenceOnly, ...(referenceOnly && config.referenceSource ? { referenceSource: config.referenceSource } : {}), ...(message ? { message } : {}), plans: catalog.plans };
      }
      return {
        configured: state.configured,
        catalogConnected: false,
        catalogStatus: (config.plans ?? []).some((plan) => plan.availability === "reference_only") ? "reference_only" : "not_configured",
        paymentChannelsLiveVerified: false,
        checkoutReady: false,
        message: config.catalogPath ? (message ?? "支付目录暂不可用") : "套餐目录未接入；尚无受信套餐目录接口配置",
        plans: (config.plans ?? []).filter(validPlan),
      };
    },
    async checkout(customerId: string | null, skuId: unknown, idempotencyKey: unknown): Promise<GuaiCheckoutOrder> {
      if (!customerId) throw new GuaiBillingError(401, "当前账号缺少可信客户身份");
      if (typeof skuId !== "string" || !SKU_RE.test(skuId)) throw new GuaiBillingError(400, "套餐编号无效");
      if (typeof idempotencyKey !== "string" || !KEY_RE.test(idempotencyKey)) throw new GuaiBillingError(400, "幂等键需为16至160个可见ASCII字符");
      const config = deps.config();
      const state = readiness(config);
      const token = guaiBillingApiToken(config);
      if (!state.checkoutReady || !state.base || !token) throw new GuaiBillingError(503, "支付服务未配置完整");
      const requestHash = `${customerId}\n${skuId}`;
      const existing = await deps.orders.getByIdempotencyKey(customerId, idempotencyKey);
      if (existing) {
        if (existing.requestHash !== requestHash) throw new GuaiBillingError(409, "幂等键已用于其他套餐");
        if (!existing.orderId.startsWith("pending-")) return { orderId: existing.orderId, skuId: existing.skuId, status: existing.status, ...(existing.checkoutUrl ? { checkoutUrl: existing.checkoutUrl } : {}) };
      }
      const catalog = await providerCatalog(config, state.base, token);
      if (!catalog) throw new GuaiBillingError(503, "本地收费模块目录未接入，暂不能创建订单");
      if (!catalog.paymentChannelsLiveVerified) throw new GuaiBillingError(503, "本地支付渠道尚未验证，暂不能创建订单");
      const plan = catalog.plans.find((item) => item.skuId === skuId && item.availability === "available" && item.checkoutEnabled !== false);
      if (!plan) throw new GuaiBillingError(409, "套餐不在支付服务的可购买目录中");
      let reservation = existing;
      if (!reservation) {
        const provisional: GuaiBillingOrderRecord = { customerId, idempotencyKey, requestHash, orderId: `pending-${crypto.randomUUID()}`, skuId, status: "pending" };
        if (await deps.orders.createIfAbsent(provisional) === "created") {
          reservation = provisional;
        } else {
          reservation = await deps.orders.getByIdempotencyKey(customerId, idempotencyKey);
          if (!reservation) throw new GuaiBillingError(503, "订单状态暂不可读，请使用原幂等键重试");
          if (reservation.requestHash !== requestHash) throw new GuaiBillingError(409, "幂等键已用于其他套餐");
          if (!reservation.orderId.startsWith("pending-")) return { orderId: reservation.orderId, skuId: reservation.skuId, status: reservation.status, ...(reservation.checkoutUrl ? { checkoutUrl: reservation.checkoutUrl } : {}) };
        }
      }
      if (!reservation) throw new GuaiBillingError(503, "订单预留状态暂不可读，请使用原幂等键重试");
      try {
        const body = await request(endpoint(state.base, "/v1/checkout-sessions"), token, {
          method: "POST",
          headers: { "content-type": "application/json", "Idempotency-Key": idempotencyKey },
          body: JSON.stringify({ customerId, skuId, returnTargetId: config.returnTargetId }),
        });
        const result = responseOrder(body);
        if (!result) throw new GuaiBillingError(502, "支付服务未返回有效订单");
        const record = { ...reservation, orderId: result.orderId, status: result.status, ...(result.checkoutUrl ? { checkoutUrl: result.checkoutUrl } : {}) };
        await deps.orders.update(record);
        return { orderId: record.orderId, skuId, status: record.status, ...(record.checkoutUrl ? { checkoutUrl: record.checkoutUrl } : {}) };
      } catch (error) {
        if (error instanceof GuaiBillingError && error.status < 500) await deps.orders.update({ ...reservation, status: "failed" });
        throw error;
      }
    },
    async order(customerId: string | null, orderId: string): Promise<GuaiCheckoutOrder> {
      if (!customerId) throw new GuaiBillingError(401, "当前账号缺少可信客户身份");
      if (!ORDER_RE.test(orderId)) throw new GuaiBillingError(400, "订单编号无效");
      const config = deps.config();
      const state = readiness(config);
      const token = guaiBillingApiToken(config);
      if (!state.base || !token) throw new GuaiBillingError(503, "支付服务未配置完整");
      const order = await deps.orders.get(customerId, orderId);
      if (!order) throw new GuaiBillingError(404, "订单不存在");
      const path = (guaiBillingStatusPath(config) ?? "/v1/orders/{orderId}").replace("{orderId}", encodeURIComponent(orderId));
      const body = await request(endpoint(state.base, path), token);
      const result = responseOrder(body);
      if (!result || result.orderId !== orderId) throw new GuaiBillingError(502, "支付服务未返回有效订单状态");
      const updated = { ...order, status: result.status, ...(result.checkoutUrl ? { checkoutUrl: result.checkoutUrl } : {}) };
      await deps.orders.update(updated);
      return { orderId, skuId: order.skuId, status: result.status, ...(result.checkoutUrl ? { checkoutUrl: result.checkoutUrl } : {}) };
    },
    async balance(customerId: string | null): Promise<GuaiBillingBalance> {
      if (!customerId) throw new GuaiBillingError(401, "当前账号缺少可信客户身份");
      const config = deps.config();
      const state = readiness(config);
      const token = guaiBillingApiToken(config);
      if (!state.base || !token) throw new GuaiBillingError(503, "本地收费模块未连接");
      const path = config.balancePath ?? "/v1/accounts/{customerId}/balance";
      const url = endpoint(state.base, path.replace("{customerId}", encodeURIComponent(customerId)));
      const root = recordPayload(await request(url, token));
      const data = recordPayload(root?.data);
      if (root?.ok !== true || typeof data?.availableCredits !== "number" || typeof data.reservedCredits !== "number") throw new GuaiBillingError(502, "本地收费模块余额响应格式无效");
      return { availableCredits: data.availableCredits, reservedCredits: data.reservedCredits };
    },
  };
}
