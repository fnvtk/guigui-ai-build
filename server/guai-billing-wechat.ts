import { createPrivateKey, createPublicKey, createSign, createVerify, randomBytes, randomUUID, X509Certificate } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import type { KeyObject } from "node:crypto";

import type { GuaiBillingPlan, GuaiCheckoutOrder, GuaiCheckoutStatus } from "../shared/guai-billing.ts";
import { GuaiWechatTransactionConflictError, type GuaiWechatOrderRecord, type GuaiWechatOrderStore } from "./guai-wechat-orders.ts";

const WECHAT_API = "https://api.mch.weixin.qq.com";
const KEY_RE = /^[\x21-\x7e]{16,160}$/;
const SKU_RE = /^[\w.-]{1,120}$/;
const ORDER_RE = /^wx-[0-9a-f-]{36}$/i;
const TRANSACTION_ID_RE = /^\d{1,32}$/;
const STATUS_BY_TRADE_STATE: Record<string, GuaiCheckoutStatus> = {
  SUCCESS: "paid",
  CLOSED: "expired",
  REVOKED: "failed",
  PAYERROR: "failed",
  NOTPAY: "pending",
  USERPAYING: "pending",
  ACCEPT: "pending",
};

export interface WechatNativeConfig {
  enabled?: boolean;
  appId?: string;
  merchantId?: string;
  apiV3Key?: string;
  merchantCertificatePath?: string;
  privateKeyPath?: string;
  platformCertificatePath?: string;
  platformSerialNo?: string;
  notifyUrl?: string;
}

export const WECHAT_NATIVE_CONFIG_FIELDS = [
  { key: "wechatNativeEnabled", secret: false, required: false },
  { key: "wechatAppId", secret: false, required: true },
  { key: "wechatMerchantId", secret: false, required: true },
  { key: "wechatApiV3Key", secret: true, required: true },
  { key: "wechatMerchantCertificatePath", secret: false, required: true },
  { key: "wechatPrivateKeyPath", secret: false, required: true },
  { key: "wechatPlatformCertificatePath", secret: false, required: true },
  { key: "wechatPlatformSerialNo", secret: false, required: true },
  { key: "wechatNotifyUrl", secret: false, required: true },
] as const;

const CONFIG_LOOKUP: Record<string, keyof WechatNativeConfig> = {
  wechatNativeEnabled: "enabled",
  wechatAppId: "appId",
  wechatMerchantId: "merchantId",
  wechatApiV3Key: "apiV3Key",
  wechatMerchantCertificatePath: "merchantCertificatePath",
  wechatPrivateKeyPath: "privateKeyPath",
  wechatPlatformCertificatePath: "platformCertificatePath",
  wechatPlatformSerialNo: "platformSerialNo",
  wechatNotifyUrl: "notifyUrl",
};

export interface WechatNativeCredentials {
  merchantPrivateKey: string | Buffer | KeyObject;
  merchantSerialNo: string;
  platformPublicKey: KeyObject;
  platformSerialNo: string;
}

export interface WechatNativeDeps {
  config(): WechatNativeConfig;
  orders: GuaiWechatOrderStore;
  catalog(): Promise<WechatNativeCatalogPlan[]>;
  fetch?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
  nonce?: () => string;
  credentials?: (config: WechatNativeConfig, signal: AbortSignal) => Promise<WechatNativeCredentials>;
  fulfillmentReady?: () => boolean | Promise<boolean>;
  onVerifiedPaid?: (record: GuaiWechatOrderRecord, signal: AbortSignal) => Promise<void>;
  apiBaseUrl?: string;
}

export interface WechatNativeCatalogPlan extends GuaiBillingPlan {
  durationMonths?: number;
}

export class WechatNativeError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

function withTimeout<T>(operation: (signal: AbortSignal) => Promise<T>, timeoutMs: number, message: string): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new WechatNativeError(503, message));
      controller.abort();
    }, timeoutMs);
  });
  return Promise.race([Promise.resolve().then(() => operation(controller.signal)), timeout]).finally(() => clearTimeout(timer!));
}

function recordPayload(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function normalSerial(value: string): string { return value.replaceAll(":", "").toUpperCase(); }

async function loadCredentials(config: WechatNativeConfig, signal: AbortSignal): Promise<WechatNativeCredentials> {
  if (!config.merchantCertificatePath || !config.privateKeyPath || !config.platformCertificatePath || !config.platformSerialNo) {
    throw new WechatNativeError(503, "微信支付证书未配置完整");
  }
  let privateKeyStat: Awaited<ReturnType<typeof stat>>;
  try { privateKeyStat = await stat(config.privateKeyPath); }
  catch { throw new WechatNativeError(503, "微信商户私钥文件无法读取，请重新导入或检查本机路径"); }
  if ((privateKeyStat.mode & 0o077) !== 0) throw new WechatNativeError(503, "微信商户私钥文件权限过宽，请限制为仅当前用户可读写");
  let privateKeyPem: Buffer;
  let merchantPem: string;
  let platformPem: string;
  try {
    [privateKeyPem, merchantPem, platformPem] = await Promise.all([
      readFile(config.privateKeyPath, { signal }), readFile(config.merchantCertificatePath, { encoding: "utf8", signal }), readFile(config.platformCertificatePath, { encoding: "utf8", signal }),
    ]);
  } catch {
    throw new WechatNativeError(503, "微信支付证书文件无法读取，请重新导入或检查本机路径");
  }
  const merchantCertificate = new X509Certificate(merchantPem);
  const platformCertificate = new X509Certificate(platformPem);
  const now = Date.now();
  if (now < Date.parse(merchantCertificate.validFrom) || now > Date.parse(merchantCertificate.validTo) ||
    now < Date.parse(platformCertificate.validFrom) || now > Date.parse(platformCertificate.validTo)) {
    throw new WechatNativeError(503, "微信支付证书已过期或尚未生效");
  }
  const privateKey = createPrivateKey(privateKeyPem);
  const merchantPublicKey = createPublicKey(privateKey);
  if (!merchantPublicKey.export({ type: "spki", format: "der" }).equals(merchantCertificate.publicKey.export({ type: "spki", format: "der" }))) {
    throw new WechatNativeError(503, "微信商户证书与私钥不匹配");
  }
  const platformSerialNo = normalSerial(platformCertificate.serialNumber);
  if (normalSerial(config.platformSerialNo) !== platformSerialNo) throw new WechatNativeError(503, "微信平台证书序列号与证书不匹配");
  return {
    merchantPrivateKey: privateKeyPem,
    merchantSerialNo: normalSerial(merchantCertificate.serialNumber),
    platformPublicKey: platformCertificate.publicKey,
    platformSerialNo,
  };
}

function validateConfig(config: WechatNativeConfig): void {
  if (config.enabled !== true) throw new WechatNativeError(503, "微信 Native 支付未启用");
  if (!config.appId || !config.merchantId || !config.apiV3Key || Buffer.byteLength(config.apiV3Key, "utf8") !== 32) {
    throw new WechatNativeError(503, "微信支付 AppID、商户号或 32 位 APIv3 密钥未配置");
  }
  if (!config.notifyUrl) throw new WechatNativeError(503, "微信支付通知地址未配置");
  let url: URL;
  try { url = new URL(config.notifyUrl); } catch { throw new WechatNativeError(503, "微信支付通知地址配置无效"); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new WechatNativeError(503, "微信支付通知地址必须是无凭据的 HTTPS URL");
}

function signRequest(method: string, requestPath: string, timestamp: string, nonce: string, body: string, config: WechatNativeConfig, credentials: WechatNativeCredentials): string {
  const message = `${method}\n${requestPath}\n${timestamp}\n${nonce}\n${body}\n`;
  const signer = createSign("RSA-SHA256");
  signer.update(message, "utf8");
  const signature = signer.sign(credentials.merchantPrivateKey, "base64");
  return `WECHATPAY2-SHA256-RSA2048 mchid="${config.merchantId}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${credentials.merchantSerialNo}",signature="${signature}"`;
}

function verifyResponse(response: Response, body: string, credentials: WechatNativeCredentials, now: number): void {
  const timestamp = response.headers.get("Wechatpay-Timestamp");
  const nonce = response.headers.get("Wechatpay-Nonce");
  const serial = response.headers.get("Wechatpay-Serial");
  const signature = response.headers.get("Wechatpay-Signature");
  if (!timestamp || !nonce || !serial || !signature || normalSerial(serial) !== credentials.platformSerialNo || !/^\d{1,12}$/.test(timestamp)) {
    throw new WechatNativeError(502, "微信支付响应缺少有效的平台签名信息");
  }
  if (Math.abs(Math.floor(now / 1000) - Number(timestamp)) > 300) throw new WechatNativeError(502, "微信支付响应签名已过期");
  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${timestamp}\n${nonce}\n${body}\n`, "utf8");
  if (!verifier.verify(credentials.platformPublicKey, signature, "base64")) throw new WechatNativeError(502, "微信支付响应签名校验失败");
}

function mapOrder(order: GuaiWechatOrderRecord, message?: string): GuaiCheckoutOrder {
  return {
    orderId: order.orderId,
    skuId: order.skuId,
    status: order.status,
    ...(order.status === "paid" ? { fulfillmentStatus: order.fulfilledAt ? "fulfilled" as const : "pending" as const } : {}),
    ...(order.checkoutUrl ? { checkoutUrl: order.checkoutUrl } : {}),
    ...(message ? { message } : {}),
  };
}

function validPlan(plan: WechatNativeCatalogPlan | undefined): plan is WechatNativeCatalogPlan & { priceVersionId: string; amountMinor: number; currency: "CNY"; includedCredits: number } {
  return !!plan && SKU_RE.test(plan.skuId) && plan.referenceOnly !== true && plan.availability === "available" && plan.checkoutEnabled === true &&
    typeof plan.priceVersionId === "string" && plan.priceVersionId.length > 0 && plan.currency === "CNY" && Number.isSafeInteger(plan.amountMinor) && (plan.amountMinor ?? 0) > 0 &&
    Number.isSafeInteger(plan.includedCredits) && (plan.includedCredits ?? 0) > 0 &&
    (plan.kind !== "subscription" || (Number.isSafeInteger(plan.durationMonths) && (plan.durationMonths ?? 0) > 0));
}

export function createWechatNativeBilling(deps: WechatNativeDeps) {
  const doFetch = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  const nonce = deps.nonce ?? (() => randomBytes(16).toString("hex"));
  const apiBase = new URL(deps.apiBaseUrl ?? WECHAT_API);
  const loopback = apiBase.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(apiBase.hostname);
  if ((deps.apiBaseUrl && !loopback) || (!loopback && apiBase.origin !== WECHAT_API) || apiBase.username || apiBase.password || apiBase.search || apiBase.hash) {
    throw new TypeError("WeChat API must use HTTPS or loopback HTTP for isolated tests");
  }
  const urlFor = (path: string) => new URL(path, apiBase);
  const credentials = (config: WechatNativeConfig) => withTimeout(
    (signal) => (deps.credentials ?? loadCredentials)(config, signal),
    deps.timeoutMs ?? 8_000,
    "微信支付证书检查超时，请检查本机权限后重试",
  );
  const fulfillmentReady = async () => {
    if (!deps.onVerifiedPaid) return false;
    if (!deps.fulfillmentReady) return true;
    return withTimeout(
      () => Promise.resolve(deps.fulfillmentReady!()),
      deps.timeoutMs ?? 8_000,
      "本机会员履约检查超时",
    );
  };
  const readiness = async () => {
    const config = deps.config();
    const missingFields = WECHAT_NATIVE_CONFIG_FIELDS.filter(({ key }) => key !== "wechatNativeEnabled").filter(({ key }) => {
      const value = config[CONFIG_LOOKUP[key]!];
      return value === undefined || value === "" ||
        (key === "wechatApiV3Key" && (typeof value !== "string" || Buffer.byteLength(value, "utf8") !== 32));
    }).map(({ key }) => key);
    if (missingFields.length) return { enabled: config.enabled === true, ready: false, fulfillmentReady: false, checkoutReady: false, missingFields };
    try {
      validateConfig({ ...config, enabled: true });
      await credentials(config);
      const fulfillment = await fulfillmentReady();
      return { enabled: config.enabled === true, ready: true, fulfillmentReady: fulfillment, checkoutReady: config.enabled === true && fulfillment, missingFields: [] };
    } catch (error) {
      const message = error instanceof Error ? error.message : "微信支付配置无效";
      return { enabled: config.enabled === true, ready: false, fulfillmentReady: false, checkoutReady: false, missingFields: [], error: message };
    }
  };

  const request = async (method: string, url: URL, body: string, config: WechatNativeConfig, keys: WechatNativeCredentials) => {
    const timestamp = String(Math.floor(now() / 1000));
    const requestNonce = nonce();
    const signature = signRequest(method, `${url.pathname}${url.search}`, timestamp, requestNonce, body, config, keys);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 8_000);
    try {
      const response = await doFetch(url, {
        method,
        headers: {
          authorization: signature,
          accept: "application/json",
          "content-type": "application/json",
          "user-agent": "openmausbot-local-billing/1",
        },
        ...(body ? { body } : {}),
        redirect: "error",
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        if (response.status === 404) return { notFound: true as const };
        throw new WechatNativeError(response.status >= 500 ? 503 : 502, `微信支付网关拒绝请求（HTTP ${response.status}）`);
      }
      verifyResponse(response, text, keys, now());
      let parsed: unknown;
      try { parsed = text ? JSON.parse(text) : null; } catch { throw new WechatNativeError(502, "微信支付返回了无法识别的数据"); }
      const data = recordPayload(parsed);
      if (!data) throw new WechatNativeError(502, "微信支付返回了无法识别的数据");
      return { notFound: false as const, data };
    } catch (error) {
      if (error instanceof WechatNativeError) throw error;
      throw new WechatNativeError(503, error instanceof Error && error.name === "AbortError" ? "微信支付请求超时，请使用原幂等键重试" : "微信支付服务暂不可用，请使用原幂等键重试");
    } finally { clearTimeout(timer); }
  };

  const query = async (snapshot: GuaiWechatOrderRecord, config: WechatNativeConfig, keys: WechatNativeCredentials) => {
    const path = `/v3/pay/transactions/out-trade-no/${encodeURIComponent(snapshot.outTradeNo)}?mchid=${encodeURIComponent(snapshot.merchantId)}`;
    return request("GET", urlFor(path), "", config, keys);
  };

  const applyProviderStatus = async (record: GuaiWechatOrderRecord, data: Record<string, unknown>) => {
    if (data.out_trade_no !== record.outTradeNo || data.appid !== record.appId || data.mchid !== record.merchantId ||
      !recordPayload(data.amount) || (data.amount as Record<string, unknown>).total !== record.amountMinor ||
      (data.amount as Record<string, unknown>).currency !== record.currency) {
      throw new WechatNativeError(502, "微信支付订单身份或金额与本机订单不一致");
    }
    const status = typeof data.trade_state === "string" ? STATUS_BY_TRADE_STATE[data.trade_state] : undefined;
    if (!status) throw new WechatNativeError(502, "微信支付返回了未知订单状态");
    let transactionId: string | undefined;
    let successTime: string | undefined;
    if (status === "paid") {
      if (typeof data.transaction_id !== "string" || !TRANSACTION_ID_RE.test(data.transaction_id)) {
        throw new WechatNativeError(502, "微信支付成功订单缺少有效交易流水号");
      }
      if (typeof data.success_time !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(data.success_time) || !Number.isFinite(Date.parse(data.success_time))) {
        throw new WechatNativeError(502, "微信支付成功订单缺少有效支付时间");
      }
      transactionId = data.transaction_id;
      successTime = data.success_time;
      if (record.transactionId && record.transactionId !== transactionId) throw new WechatNativeError(502, "微信支付交易流水号与本机记录不一致");
      if (record.successTime && record.successTime !== successTime) throw new WechatNativeError(502, "微信支付时间与本机记录不一致");
    }
    const updated = { ...record, status, ...(transactionId ? { transactionId, successTime } : {}) };
    try { await deps.orders.update(updated); }
    catch (error) {
      if (error instanceof GuaiWechatTransactionConflictError) throw new WechatNativeError(409, "微信交易流水号已绑定其他本机订单");
      throw error;
    }
    return updated;
  };

  const ensureFulfilled = async (record: GuaiWechatOrderRecord): Promise<{ record: GuaiWechatOrderRecord; message?: string }> => {
    if (record.status !== "paid" || record.fulfilledAt) return { record };
    if (!deps.onVerifiedPaid) return { record, message: "支付已确认，会员履约尚未接入" };
    if (!(await fulfillmentReady())) return { record, message: "支付已确认，本机会员履约暂不可用" };
    try {
      await withTimeout(
        (signal) => deps.onVerifiedPaid!(record, signal),
        deps.timeoutMs ?? 8_000,
        "支付已核实，但本机会员履约超时，请使用原订单重试",
      );
      return { record: await deps.orders.markFulfilled(record, new Date(now()).toISOString()) };
    } catch (error) {
      return { record, message: error instanceof WechatNativeError ? error.message : "支付已确认，会员权益发放失败；可查询原订单重试" };
    }
  };

  return {
    readiness,
    async checkout(customerId: string | null, skuId: unknown, idempotencyKey: unknown): Promise<GuaiCheckoutOrder> {
      if (!customerId) throw new WechatNativeError(401, "当前账号缺少可信客户身份");
      if (typeof skuId !== "string" || typeof idempotencyKey !== "string" || !SKU_RE.test(skuId) || !KEY_RE.test(idempotencyKey)) {
        throw new WechatNativeError(400, "套餐编号或幂等键无效");
      }
      if (!(await fulfillmentReady())) throw new WechatNativeError(503, "本机会员履约未就绪，暂不能发起支付");
      const config = deps.config();
      validateConfig(config);
      const keys = await credentials(config);
      const catalog = await deps.catalog();
      const plan = catalog.find((item) => item.skuId === skuId);
      if (!validPlan(plan)) throw new WechatNativeError(409, "该套餐没有可用的本机服务端价格配置");
      const candidate: GuaiWechatOrderRecord = {
        customerId,
        idempotencyKey,
        skuId,
        description: plan.name.slice(0, 127),
        kind: plan.kind ?? "credits",
        includedCredits: plan.includedCredits,
        ...(plan.durationMonths ? { durationMonths: plan.durationMonths } : {}),
        priceVersionId: plan.priceVersionId,
        amountMinor: plan.amountMinor,
        currency: "CNY",
        outTradeNo: randomUUID().replaceAll("-", "").slice(0, 32),
        merchantId: config.merchantId!,
        appId: config.appId!,
        orderId: `wx-${randomUUID()}`,
        status: "pending",
      };
      let record = await deps.orders.createIfAbsent(candidate);
      if (record.skuId !== candidate.skuId || record.priceVersionId !== candidate.priceVersionId || record.amountMinor !== candidate.amountMinor ||
        record.includedCredits !== candidate.includedCredits || record.kind !== candidate.kind || record.durationMonths !== candidate.durationMonths ||
        record.currency !== candidate.currency || record.merchantId !== candidate.merchantId || record.appId !== candidate.appId) {
        throw new WechatNativeError(409, "幂等键已用于其他套餐或价格版本");
      }
      if (record.status === "paid") {
        const fulfillment = await ensureFulfilled(record);
        return mapOrder(fulfillment.record, fulfillment.message);
      }
      if (record.checkoutUrl || record.status === "failed" || record.status === "expired") return mapOrder(record);

      if (record.orderId !== candidate.orderId) {
        const statusResult = await query(record, config, keys);
        if (!statusResult.notFound) {
          const fulfillment = await ensureFulfilled(await applyProviderStatus(record, statusResult.data));
          return mapOrder(fulfillment.record, fulfillment.message);
        }
      }

      const body = JSON.stringify({
        appid: record.appId,
        mchid: record.merchantId,
        description: record.description,
        out_trade_no: record.outTradeNo,
        notify_url: config.notifyUrl,
        amount: { total: record.amountMinor, currency: record.currency },
      });
      const result = await request("POST", urlFor("/v3/pay/transactions/native"), body, config, keys);
      if (result.notFound) throw new WechatNativeError(502, "微信支付没有返回有效扫码订单");
      const codeUrl = result.data.code_url;
      if (typeof codeUrl !== "string" || !codeUrl.startsWith("weixin://wxpay/bizpayurl?")) throw new WechatNativeError(502, "微信支付没有返回有效扫码地址");
      record = { ...record, checkoutUrl: codeUrl, status: "pending" };
      await deps.orders.update(record);
      return mapOrder(record);
    },

    async order(customerId: string | null, orderId: string): Promise<GuaiCheckoutOrder> {
      if (!customerId) throw new WechatNativeError(401, "当前账号缺少可信客户身份");
      if (!ORDER_RE.test(orderId)) throw new WechatNativeError(400, "订单编号无效");
      const record = await deps.orders.get(customerId, orderId);
      if (!record) throw new WechatNativeError(404, "订单不存在");
      if (record.status === "paid") {
        const fulfillment = await ensureFulfilled(record);
        return mapOrder(fulfillment.record, fulfillment.message);
      }
      const config = deps.config();
      validateConfig(config);
      const keys = await credentials(config);
      const result = await query(record, config, keys);
      if (result.notFound) throw new WechatNativeError(404, "微信支付侧尚未查到此订单，请使用原幂等键重试");
      const fulfillment = await ensureFulfilled(await applyProviderStatus(record, result.data));
      return mapOrder(fulfillment.record, fulfillment.message);
    },
  };
}
