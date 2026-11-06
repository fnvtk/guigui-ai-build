import { createSign, createVerify, generateKeyPairSync } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createWechatNativeBilling, type WechatNativeCatalogPlan, type WechatNativeConfig, type WechatNativeCredentials } from "./guai-billing-wechat.ts";
import { GuaiWechatSqliteOrderStore, type GuaiWechatOrderRecord } from "./guai-wechat-orders.ts";

const merchant = generateKeyPairSync("rsa", { modulusLength: 2048 });
const platform = generateKeyPairSync("rsa", { modulusLength: 2048 });
const wrongPlatform = generateKeyPairSync("rsa", { modulusLength: 2048 });
const fixedNow = 1_800_000_000_000;
const baseConfig: WechatNativeConfig = {
  enabled: true,
  appId: "wx-app-1",
  merchantId: "mch-1",
  apiV3Key: "01234567890123456789012345678901",
  merchantCertificatePath: "/private/merchant.pem",
  privateKeyPath: "/private/merchant-key.pem",
  platformCertificatePath: "/private/platform.pem",
  platformSerialNo: "PLATFORM-1",
  notifyUrl: "https://localhost.invalid/api/guai-billing/wechat/notify",
};
const credentials: WechatNativeCredentials = {
  merchantPrivateKey: merchant.privateKey,
  merchantSerialNo: "MERCHANT-1",
  platformPublicKey: platform.publicKey,
  platformSerialNo: "PLATFORM-1",
};
const validPlans: WechatNativeCatalogPlan[] = [
  { skuId: "pro", name: "专业会员", kind: "subscription", durationMonths: 1, includedCredits: 8000, availability: "available", checkoutEnabled: true, priceVersionId: "price-v1", amountMinor: 19800, currency: "CNY" },
  { skuId: "team", name: "团队会员", kind: "subscription", durationMonths: 1, includedCredits: 12000, availability: "available", checkoutEnabled: true, priceVersionId: "price-v2", amountMinor: 29800, currency: "CNY" },
];

const stores: GuaiWechatSqliteOrderStore[] = [];
const dirs: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const store of stores.splice(0)) store.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "guai-wechat-"));
  dirs.push(dir);
  const store = new GuaiWechatSqliteOrderStore(join(dir, "wechat-orders.db"));
  stores.push(store);
  return store;
}

function persistedStoreFixture() {
  const dir = mkdtempSync(join(tmpdir(), "guai-wechat-persisted-"));
  dirs.push(dir);
  const path = join(dir, "wechat-orders.db");
  const store = new GuaiWechatSqliteOrderStore(path);
  stores.push(store);
  return { store, path };
}

async function bodyOf(request: IncomingMessage): Promise<string> {
  let body = "";
  for await (const chunk of request) body += chunk;
  return body;
}

function sendSigned(response: import("node:http").ServerResponse, status: number, value: unknown, signingKey = platform.privateKey) {
  const body = JSON.stringify(value);
  const timestamp = String(Math.floor(fixedNow / 1000));
  const nonce = "platform-nonce";
  const signer = createSign("RSA-SHA256");
  signer.update(`${timestamp}\n${nonce}\n${body}\n`, "utf8");
  response.writeHead(status, {
    "content-type": "application/json",
    "Wechatpay-Timestamp": timestamp,
    "Wechatpay-Nonce": nonce,
    "Wechatpay-Serial": "PLATFORM-1",
    "Wechatpay-Signature": signer.sign(signingKey, "base64"),
  });
  response.end(body);
}

async function mockApi(handler: (request: IncomingMessage, response: import("node:http").ServerResponse, body: string) => Promise<void>) {
  const server = createServer(async (request, response) => handler(request, response, await bodyOf(request)));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("mock server did not bind a TCP port");
  return `http://127.0.0.1:${address.port}`;
}

function assertMerchantSignature(request: IncomingMessage, body: string) {
  const header = request.headers.authorization ?? "";
  const values = Object.fromEntries([...header.matchAll(/([a-z_]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]));
  const timestamp = values.timestamp;
  const nonce = values.nonce_str;
  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${request.method}\n${request.url}\n${timestamp}\n${nonce}\n${body}\n`, "utf8");
  expect(header.startsWith("WECHATPAY2-SHA256-RSA2048 ")).toBe(true);
  expect(values.mchid).toBe("mch-1");
  expect(values.serial_no).toBe("MERCHANT-1");
  expect(verifier.verify(merchant.publicKey, values.signature, "base64")).toBe(true);
}

function adapter(options: {
  store: GuaiWechatSqliteOrderStore;
  baseUrl: string;
  config?: WechatNativeConfig;
  plans?: WechatNativeCatalogPlan[];
  onVerifiedPaid?: (record: GuaiWechatOrderRecord) => Promise<void>;
}) {
  return createWechatNativeBilling({
    config: () => options.config ?? baseConfig,
    orders: options.store,
    catalog: async () => options.plans ?? validPlans,
    apiBaseUrl: options.baseUrl,
    now: () => fixedNow,
    nonce: () => "request-nonce",
    credentials: async () => credentials,
    onVerifiedPaid: options.onVerifiedPaid ? (record) => options.onVerifiedPaid!(record) : async () => {},
    timeoutMs: 1_000,
  });
}

describe("local WeChat Native billing adapter", () => {
  it("keeps provider price and merchant order snapshots across a store restart", async () => {
    const { store, path } = persistedStoreFixture();
    const order = {
      customerId: "customer",
      idempotencyKey: "idempotency-key-persist-1",
      skuId: "pro",
      description: "专业会员",
      kind: "subscription",
      includedCredits: 8000,
      durationMonths: 1,
      priceVersionId: "price-v1",
      amountMinor: 19800,
      currency: "CNY" as const,
      outTradeNo: "wxouttrade00000000000000000000001",
      merchantId: "mch-1",
      appId: "wx-app-1",
      orderId: "wx-00000000-0000-4000-8000-000000000001",
      status: "pending" as const,
    };
    expect(await store.createIfAbsent(order)).toEqual(order);
    store.close();
    stores.splice(stores.indexOf(store), 1);
    const reopened = new GuaiWechatSqliteOrderStore(path);
    stores.push(reopened);
    expect(await reopened.getByIdempotencyKey(order.customerId, order.idempotencyKey)).toEqual(order);
  });

  it("uses the host price, signs the request, and returns the same durable order for the same key", async () => {
    let creates = 0;
    const baseUrl = await mockApi(async (request, response, body) => {
      assertMerchantSignature(request, body);
      expect(request.method).toBe("POST");
      expect(request.url).toBe("/v3/pay/transactions/native");
      const payload = JSON.parse(body);
      expect(payload.amount).toEqual({ total: 19800, currency: "CNY" });
      expect(payload.appid).toBe("wx-app-1");
      creates += 1;
      sendSigned(response, 200, { code_url: "weixin://wxpay/bizpayurl?pr=mock" });
    });
    const billing = adapter({ store: fixture(), baseUrl });
    const order = await billing.checkout("trusted-customer", "pro", "idempotency-key-0001");
    expect(order).toMatchObject({ skuId: "pro", status: "pending", checkoutUrl: "weixin://wxpay/bizpayurl?pr=mock" });
    expect(await billing.checkout("trusted-customer", "pro", "idempotency-key-0001")).toEqual(order);
    expect(creates).toBe(1);
  });

  it("retries a pending reservation after HTTP 503 with the same merchant order and rejects changed SKU or price", async () => {
    let firstCreate = true;
    let orderQuery = 0;
    const plans = [...validPlans];
    const createBodies: Array<Record<string, unknown>> = [];
    const baseUrl = await mockApi(async (request, response, body) => {
      assertMerchantSignature(request, body);
      if (request.method === "GET") {
        orderQuery += 1;
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ code: "ORDER_NOT_EXIST" }));
        return;
      }
      createBodies.push(JSON.parse(body));
      if (firstCreate) {
        firstCreate = false;
        response.writeHead(503, { "content-type": "application/json" });
        response.end(JSON.stringify({ message: "unavailable" }));
        return;
      }
      sendSigned(response, 200, { code_url: "weixin://wxpay/bizpayurl?pr=retry" });
    });
    const store = fixture();
    const billing = adapter({ store, baseUrl, plans });
    await expect(billing.checkout("trusted-customer", "pro", "idempotency-key-0002")).rejects.toMatchObject({ status: 503 });
    const retry = await billing.checkout("trusted-customer", "pro", "idempotency-key-0002");
    expect(retry.status).toBe("pending");
    expect(createBodies).toHaveLength(2);
    expect(createBodies[0]).toEqual(createBodies[1]);
    expect(orderQuery).toBe(1);
    await expect(billing.checkout("trusted-customer", "team", "idempotency-key-0002")).rejects.toMatchObject({ status: 409 });
    plans[0] = { ...validPlans[0]!, priceVersionId: "price-v3", amountMinor: 19900 };
    await expect(billing.checkout("trusted-customer", "pro", "idempotency-key-0002")).rejects.toMatchObject({ status: 409 });
    expect(createBodies).toHaveLength(2);
  });

  it("checks owner, provider identity and amount before storing a paid result", async () => {
    let createPayload: Record<string, unknown> | undefined;
    const baseUrl = await mockApi(async (request, response, body) => {
      assertMerchantSignature(request, body);
      if (request.method === "POST") {
        createPayload = JSON.parse(body);
        sendSigned(response, 200, { code_url: "weixin://wxpay/bizpayurl?pr=verify" });
        return;
      }
      if (!createPayload) throw new Error("expected a create before query");
      const queryResult = {
        out_trade_no: createPayload.out_trade_no,
        appid: createPayload.appid,
        mchid: createPayload.mchid,
        amount: { total: 19800, currency: "CNY" },
        trade_state: "SUCCESS",
        transaction_id: "4200000000000000000000000001",
        success_time: "2026-11-04T12:30:00+08:00",
      };
      sendSigned(response, 200, queryResult);
    });
    const store = fixture();
    const billing = adapter({ store, baseUrl });
    const created = await billing.checkout("customer-a", "pro", "idempotency-key-0003");
    await expect(billing.order("customer-b", created.orderId)).rejects.toMatchObject({ status: 404 });
    expect(await billing.order("customer-a", created.orderId)).toMatchObject({ status: "paid", fulfillmentStatus: "fulfilled" });
    const stored = await store.get("customer-a", created.orderId);
    expect(stored?.status).toBe("paid");
    expect(stored?.transactionId).toBe("4200000000000000000000000001");
    expect(stored?.successTime).toBe("2026-11-04T12:30:00+08:00");
    expect(stored?.fulfilledAt).toBeDefined();
  });

  it("rejects an invalid platform signature and an amount mismatch without marking the order paid", async () => {
    let createPayload: Record<string, unknown> | undefined;
    let signedWithWrongKey = false;
    let wrongAmount = false;
    const baseUrl = await mockApi(async (request, response, body) => {
      assertMerchantSignature(request, body);
      if (request.method === "POST") {
        createPayload = JSON.parse(body);
        sendSigned(response, 200, { code_url: "weixin://wxpay/bizpayurl?pr=check" });
        return;
      }
      if (!createPayload) throw new Error("expected a create before query");
      sendSigned(response, 200, {
        out_trade_no: createPayload.out_trade_no,
        appid: createPayload.appid,
        mchid: createPayload.mchid,
        amount: { total: wrongAmount ? 1 : 19800, currency: "CNY" },
        trade_state: "SUCCESS",
        transaction_id: "4200000000000000000000000002",
        success_time: "2026-11-04T12:30:00+08:00",
      }, signedWithWrongKey ? wrongPlatform.privateKey : platform.privateKey);
    });
    const store = fixture();
    const billing = adapter({ store, baseUrl });
    const created = await billing.checkout("customer-a", "pro", "idempotency-key-0004");
    signedWithWrongKey = true;
    await expect(billing.order("customer-a", created.orderId)).rejects.toThrow("响应签名校验失败");
    signedWithWrongKey = false;
    wrongAmount = true;
    await expect(billing.order("customer-a", created.orderId)).rejects.toThrow("身份或金额");
    expect((await store.get("customer-a", created.orderId))?.status).toBe("pending");
  });

  it("does not mark success paid without a valid transaction ID and rejects reuse across orders", async () => {
    const createPayloads = new Map<string, Record<string, unknown>>();
    let includeTransactionId = false;
    const baseUrl = await mockApi(async (request, response, body) => {
      assertMerchantSignature(request, body);
      if (request.method === "POST") {
        const payload = JSON.parse(body);
        createPayloads.set(payload.out_trade_no, payload);
        sendSigned(response, 200, { code_url: `weixin://wxpay/bizpayurl?pr=${payload.out_trade_no}` });
        return;
      }
      const outTradeNo = (request.url ?? "").split("?")[0]!.split("/").at(-1)!;
      const payload = createPayloads.get(outTradeNo)!;
      sendSigned(response, 200, {
        out_trade_no: outTradeNo,
        appid: payload.appid,
        mchid: payload.mchid,
        amount: payload.amount,
        trade_state: "SUCCESS",
        success_time: "2026-11-04T12:30:00+08:00",
        ...(includeTransactionId ? { transaction_id: "4200000000000000000000000003" } : {}),
      });
    });
    const store = fixture();
    const billing = adapter({ store, baseUrl });
    const first = await billing.checkout("customer-a", "pro", "idempotency-key-0007");
    await expect(billing.order("customer-a", first.orderId)).rejects.toThrow("缺少有效交易流水号");
    expect((await store.get("customer-a", first.orderId))?.status).toBe("pending");
    includeTransactionId = true;
    expect((await billing.order("customer-a", first.orderId)).status).toBe("paid");
    const second = await billing.checkout("customer-b", "pro", "idempotency-key-0008");
    await expect(billing.order("customer-b", second.orderId)).rejects.toThrow("已绑定其他本机订单");
    const secondStored = await store.get("customer-b", second.orderId);
    expect(secondStored?.status).toBe("pending");
    expect(secondStored?.transactionId).toBeUndefined();
  });

  it("bounds readiness and checkout credential preparation when a file read stalls", async () => {
    const baseUrl = await mockApi(async (_request, response) => {
      response.writeHead(500);
      response.end();
    });
    const billing = createWechatNativeBilling({
      config: () => baseConfig,
      orders: fixture(),
      catalog: async () => validPlans,
      apiBaseUrl: baseUrl,
      timeoutMs: 20,
      credentials: () => new Promise<WechatNativeCredentials>(() => {}),
      onVerifiedPaid: async () => {},
    });
    const started = Date.now();
    const readiness = await billing.readiness();
    expect(readiness.ready).toBe(false);
    expect(readiness.error).toContain("检查超时");
    expect(Date.now() - started).toBeLessThan(500);
    await expect(billing.checkout("customer", "pro", "idempotency-key-0009")).rejects.toThrow("检查超时");
  });

  it("rejects a broadly accessible private-key path before trying to read it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "guai-wechat-key-permission-"));
    dirs.push(dir);
    chmodSync(dir, 0o755);
    const baseUrl = await mockApi(async (_request, response) => {
      response.writeHead(500);
      response.end();
    });
    const billing = createWechatNativeBilling({
      config: () => ({ ...baseConfig, privateKeyPath: dir }),
      orders: fixture(),
      catalog: async () => validPlans,
      apiBaseUrl: baseUrl,
      timeoutMs: 200,
      onVerifiedPaid: async () => {},
    });
    const result = await billing.readiness();
    expect(result.ready).toBe(false);
    expect(result.error).toContain("权限过宽");
  });

  it("keeps checkout closed without host fulfillment and retries an idempotent grant after failure", async () => {
    let createPayload: Record<string, unknown> | undefined;
    const baseUrl = await mockApi(async (request, response, body) => {
      assertMerchantSignature(request, body);
      if (request.method === "POST") {
        createPayload = JSON.parse(body);
        sendSigned(response, 200, { code_url: "weixin://wxpay/bizpayurl?pr=fulfill" });
        return;
      }
      if (!createPayload) throw new Error("expected a create before query");
      sendSigned(response, 200, {
        out_trade_no: createPayload.out_trade_no,
        appid: createPayload.appid,
        mchid: createPayload.mchid,
        amount: createPayload.amount,
        trade_state: "SUCCESS",
        transaction_id: "4200000000000000000000000004",
        success_time: "2026-11-04T12:30:00+08:00",
      });
    });
    const store = fixture();
    const noFulfillment = createWechatNativeBilling({
      config: () => baseConfig,
      orders: store,
      catalog: async () => validPlans,
      apiBaseUrl: baseUrl,
      credentials: async () => credentials,
    });
    expect((await noFulfillment.readiness()).checkoutReady).toBe(false);
    await expect(noFulfillment.checkout("customer", { skuId: "pro" }, "idempotency-key-0010")).rejects.toMatchObject({ status: 400 });
    await expect(noFulfillment.checkout("customer", "pro", "idempotency-key-0010")).rejects.toThrow("履约未就绪");

    let calls = 0;
    const billing = adapter({
      store,
      baseUrl,
      onVerifiedPaid: async (record) => {
        calls += 1;
        expect(record).toMatchObject({
          transactionId: "4200000000000000000000000004",
          successTime: "2026-11-04T12:30:00+08:00",
          includedCredits: 8000,
          durationMonths: 1,
        });
        if (calls === 1) throw new Error("synthetic ledger unavailable");
      },
    });
    const created = await billing.checkout("customer", "pro", "idempotency-key-0011");
    await expect(billing.order("customer", created.orderId)).resolves.toMatchObject({ status: "paid", fulfillmentStatus: "pending" });
    expect((await store.get("customer", created.orderId))?.status).toBe("paid");
    expect((await store.get("customer", created.orderId))?.fulfilledAt).toBeUndefined();
    expect(await billing.order("customer", created.orderId)).toMatchObject({ status: "paid", fulfillmentStatus: "fulfilled" });
    expect((await store.get("customer", created.orderId))?.fulfilledAt).toBeDefined();
    expect(await billing.order("customer", created.orderId)).toMatchObject({ status: "paid", fulfillmentStatus: "fulfilled" });
    expect(calls).toBe(2);
  });

  it("does not call the gateway when config is disabled or the host catalog has only reference prices", async () => {
    let calls = 0;
    const baseUrl = await mockApi(async (_request, response) => {
      calls += 1;
      response.writeHead(500);
      response.end();
    });
    const store = fixture();
    const disabled = adapter({ store, baseUrl, config: { ...baseConfig, enabled: false } });
    expect((await disabled.readiness()).ready).toBe(true);
    expect((await disabled.readiness()).checkoutReady).toBe(false);
    await expect(disabled.checkout("customer", "pro", "idempotency-key-0005")).rejects.toThrow("未启用");
    const referenceOnly = adapter({
      store,
      baseUrl,
      plans: [{ ...validPlans[0]!, availability: "reference_only", checkoutEnabled: false, referenceOnly: true }],
    });
    await expect(referenceOnly.checkout("customer", "pro", "idempotency-key-0006")).rejects.toMatchObject({ status: 409 });
    expect(calls).toBe(0);
  });
});
