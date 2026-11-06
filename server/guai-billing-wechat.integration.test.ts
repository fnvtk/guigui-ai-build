import { createSign, createVerify, generateKeyPairSync } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { createGuaiBilling } from "./guai-billing.ts";
import { createGuaiWechatFulfillment } from "./guai-billing-fulfillment.ts";
import { GuaiBillingLocalModule } from "./guai-billing-local-module.ts";
import { createWechatNativeBilling, type WechatNativeConfig, type WechatNativeCredentials } from "./guai-billing-wechat.ts";
import { GuaiWechatSqliteEntitlementStore } from "./guai-wechat-entitlements.ts";
import { GuaiWechatSqliteOrderStore } from "./guai-wechat-orders.ts";

const moduleDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../../../4、模块/支付模块/10_运行时_统一收费核心");
const customerId = "synthetic-wechat-customer";
const fixedNow = Date.parse("2026-11-04T04:30:00Z");
const merchant = generateKeyPairSync("rsa", { modulusLength: 2048 });
const platform = generateKeyPairSync("rsa", { modulusLength: 2048 });
const credentials: WechatNativeCredentials = {
  merchantPrivateKey: merchant.privateKey,
  merchantSerialNo: "TEST-MERCHANT-SERIAL",
  platformPublicKey: platform.publicKey,
  platformSerialNo: "TEST-PLATFORM-SERIAL",
};
const config: WechatNativeConfig = {
  enabled: true,
  appId: "wx-test-app",
  merchantId: "1900000001",
  apiV3Key: "01234567890123456789012345678901",
  merchantCertificatePath: "/not-read-in-this-mock/merchant.pem",
  privateKeyPath: "/not-read-in-this-mock/merchant-key.pem",
  platformCertificatePath: "/not-read-in-this-mock/platform.pem",
  platformSerialNo: "TEST-PLATFORM-SERIAL",
  notifyUrl: "https://localhost.invalid/api/guai-billing/wechat/notify",
};

const modules: GuaiBillingLocalModule[] = [];
const stores: Array<{ close(): void }> = [];
const servers: Server[] = [];
const tempDirs: string[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  for (const module of modules.splice(0)) await module.close();
  for (const store of stores.splice(0)) store.close();
  for (const path of tempDirs.splice(0)) rmSync(path, { recursive: true, force: true });
});

async function readBody(request: IncomingMessage): Promise<string> {
  let body = "";
  for await (const chunk of request) body += chunk;
  return body;
}

function assertMerchantSignature(request: IncomingMessage, body: string): void {
  const authorization = request.headers.authorization ?? "";
  const fields = Object.fromEntries([...authorization.matchAll(/([a-z_]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]));
  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${request.method}\n${request.url}\n${fields.timestamp}\n${fields.nonce_str}\n${body}\n`, "utf8");
  expect(fields.mchid).toBe(config.merchantId);
  expect(verifier.verify(merchant.publicKey, fields.signature, "base64")).toBe(true);
}

function replySigned(response: ServerResponse, value: unknown): void {
  const body = JSON.stringify(value);
  const timestamp = String(Math.floor(fixedNow / 1000));
  const nonce = "signed-local-wechat-fixture";
  const signer = createSign("RSA-SHA256");
  signer.update(`${timestamp}\n${nonce}\n${body}\n`, "utf8");
  response.writeHead(200, {
    "content-type": "application/json",
    "Wechatpay-Timestamp": timestamp,
    "Wechatpay-Nonce": nonce,
    "Wechatpay-Serial": credentials.platformSerialNo,
    "Wechatpay-Signature": signer.sign(platform.privateKey, "base64"),
  });
  response.end(body);
}

async function startMockGateway(): Promise<string> {
  const createdOrders = new Map<string, Record<string, unknown>>();
  const server = createServer(async (request, response) => {
    const body = await readBody(request);
    assertMerchantSignature(request, body);
    if (request.method === "POST" && request.url === "/v3/pay/transactions/native") {
      const order = JSON.parse(body) as Record<string, unknown>;
      expect(order.amount).toEqual({ total: 19800, currency: "CNY" });
      createdOrders.set(String(order.out_trade_no), order);
      replySigned(response, { code_url: `weixin://wxpay/bizpayurl?pr=${order.out_trade_no}` });
      return;
    }
    if (request.method === "GET") {
      const outTradeNo = (request.url ?? "").split("?")[0]!.split("/").at(-1)!;
      const order = createdOrders.get(outTradeNo);
      if (order) {
        replySigned(response, {
          out_trade_no: outTradeNo,
          appid: order.appid,
          mchid: order.mchid,
          amount: order.amount,
          trade_state: "SUCCESS",
          transaction_id: "4200000000000000000000000099",
          success_time: "2026-11-01T12:30:00+08:00",
        });
        return;
      }
    }
    response.writeHead(404);
    response.end();
  });
  servers.push(server);
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("mock gateway failed to bind loopback");
  return `http://127.0.0.1:${address.port}`;
}

describe("integrated local WeChat checkout and fulfillment", () => {
  it("recovers after a post-grant interruption and reads back exactly one credit lot and membership period", async () => {
    const temp = mkdtempSync(join(tmpdir(), "guai-wechat-integration-"));
    tempDirs.push(temp);
    const localModule = new GuaiBillingLocalModule({
      enabled: true,
      moduleDirectory,
      privateDirectory: join(temp, "billing-runtime"),
      appId: "openmausbot-guai-local-test",
      tenantId: "synthetic-local-tenant",
      catalog: [{ skuId: "pro", priceVersionId: "pro-v1", currency: "CNY", amountMinor: 19800, includedCredits: 8000, kind: "subscription" }],
      startupTimeoutMs: 8_000,
    });
    modules.push(localModule);
    const connection = await localModule.start();
    const orders = new GuaiWechatSqliteOrderStore(join(temp, "wechat-orders.sqlite"));
    const entitlements = new GuaiWechatSqliteEntitlementStore(join(temp, "wechat-entitlements.sqlite"));
    stores.push(orders, entitlements);
    const hostBilling = createGuaiBilling({
      config: () => connection,
      orders: { get: async () => null, getByIdempotencyKey: async () => null, createIfAbsent: async () => "created", update: async () => undefined },
    });
    const fulfillment = createGuaiWechatFulfillment({ localModule, entitlements, now: () => fixedNow });
    const gatewayUrl = await startMockGateway();
    let fulfillmentCalls = 0;
    const native = createWechatNativeBilling({
      config: () => config,
      orders,
      catalog: async () => [{
        skuId: "pro",
        name: "测试专业会员",
        kind: "subscription",
        durationMonths: 1,
        includedCredits: 8000,
        currency: "CNY",
        amountMinor: 19800,
        priceVersionId: "pro-v1",
        availability: "available",
        checkoutEnabled: true,
      }],
      apiBaseUrl: gatewayUrl,
      now: () => fixedNow,
      nonce: () => "signed-local-merchant-request",
      credentials: async () => credentials,
      fulfillmentReady: fulfillment.ready,
      onVerifiedPaid: async (record, signal) => {
        fulfillmentCalls += 1;
        await fulfillment.onVerifiedPaid(record, signal);
        if (fulfillmentCalls === 1) throw new Error("simulated host interruption after durable grant");
      },
      timeoutMs: 2_000,
    });

    expect(await native.readiness()).toMatchObject({ ready: true, fulfillmentReady: true, checkoutReady: true });
    const created = await native.checkout(customerId, "pro", "integrated-idempotency-key-01");
    expect(created).toMatchObject({ status: "pending", checkoutUrl: expect.stringMatching(/^weixin:\/\//) });

    const firstPoll = await native.order(customerId, created.orderId);
    expect(firstPoll).toMatchObject({ status: "paid", fulfillmentStatus: "pending" });
    expect((await orders.get(customerId, created.orderId))?.fulfilledAt).toBeUndefined();
    expect(await hostBilling.balance(customerId)).toEqual({ availableCredits: 8000, reservedCredits: 0 });
    const pendingMembership = await fulfillment.readEntitlement(customerId, fixedNow);
    expect(pendingMembership.memberships).toHaveLength(1);
    expect(pendingMembership.active).toBe(true);

    expect(await native.order(customerId, created.orderId)).toMatchObject({ status: "paid", fulfillmentStatus: "fulfilled" });
    expect(await native.order(customerId, created.orderId)).toMatchObject({ status: "paid", fulfillmentStatus: "fulfilled" });
    expect(fulfillmentCalls).toBe(2);
    expect(await hostBilling.balance(customerId)).toEqual({ availableCredits: 8000, reservedCredits: 0 });
    expect(await fulfillment.readEntitlement(customerId, fixedNow)).toMatchObject({ active: true, memberships: [{
      orderId: created.orderId,
      transactionId: "4200000000000000000000000099",
      startsAt: "2026-11-01T04:30:00.000Z",
      endsAt: "2026-12-01T04:30:00.000Z",
      includedCredits: 8000,
    }] });
  });
});
