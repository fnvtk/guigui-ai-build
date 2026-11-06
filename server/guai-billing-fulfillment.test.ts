import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createGuaiWechatFulfillment } from "./guai-billing-fulfillment.ts";
import { GuaiWechatSqliteEntitlementStore } from "./guai-wechat-entitlements.ts";
import type { VerifiedPaymentGrant } from "./guai-billing-local-module.ts";
import type { GuaiWechatOrderRecord } from "./guai-wechat-orders.ts";

const dirs: string[] = [];
const stores: GuaiWechatSqliteEntitlementStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "guai-wechat-entitlements-"));
  dirs.push(dir);
  const store = new GuaiWechatSqliteEntitlementStore(join(dir, "entitlements.sqlite"));
  stores.push(store);
  return store;
}

const order: GuaiWechatOrderRecord = {
  customerId: "customer-1",
  idempotencyKey: "idempotency-key-entitlement-1",
  skuId: "pro",
  description: "专业会员",
  kind: "subscription",
  includedCredits: 8000,
  durationMonths: 1,
  priceVersionId: "price-v1",
  amountMinor: 19800,
  currency: "CNY",
  outTradeNo: "wxouttrade00000000000000000000002",
  merchantId: "mch-1",
  appId: "wx-app-1",
  orderId: "wx-00000000-0000-4000-8000-000000000002",
  status: "paid",
  transactionId: "4200000000000000000000000010",
  successTime: "2026-01-31T12:30:00+08:00",
};

describe("verified local billing fulfillment", () => {
  it("grants credits by transaction ID and reads back a month from signed success time", async () => {
    const entitlements = fixture();
    const grants = new Map<string, number>();
    const grantExpiries = new Map<string, string | undefined>();
    const fulfillment = createGuaiWechatFulfillment({
      localModule: {
        state: "ready",
        async grantVerifiedPayment(input: VerifiedPaymentGrant) {
          const old = grants.get(input.transactionId);
          if (old !== undefined && old !== input.credits) throw new Error("grant conflict");
          grants.set(input.transactionId, input.credits);
          grantExpiries.set(input.transactionId, input.expiresAt);
          return { lotId: `lot-${input.transactionId}`, reused: old !== undefined };
        },
      },
      entitlements,
    });

    await fulfillment.onVerifiedPaid(order, new AbortController().signal);
    await fulfillment.onVerifiedPaid(order, new AbortController().signal);
    expect(grants.get(order.transactionId!)).toBe(8000);
    expect(grantExpiries.get(order.transactionId!)).toBe("2026-02-28T04:30:00.000Z");
    expect((await fulfillment.readEntitlement(order.customerId, Date.parse("2026-02-01T00:00:00+08:00"))).memberships[0]).toEqual({
      customerId: order.customerId,
      orderId: order.orderId,
      transactionId: order.transactionId,
      merchantId: order.merchantId,
      skuId: order.skuId,
      priceVersionId: order.priceVersionId,
      includedCredits: 8000,
      durationMonths: 1,
      startsAt: "2026-01-31T04:30:00.000Z",
      endsAt: "2026-02-28T04:30:00.000Z",
    });
    expect((await fulfillment.readEntitlement(order.customerId, Date.parse("2026-02-01T00:00:00+08:00"))).active).toBe(true);
    expect((await fulfillment.readEntitlement(order.customerId, Date.parse("2026-03-01T00:00:00+08:00"))).active).toBe(false);
  });

  it("rejects reuse of a provider transaction across distinct local orders", async () => {
    const entitlements = fixture();
    await entitlements.grantFromVerifiedPayment(order);
    await expect(entitlements.grantFromVerifiedPayment({ ...order, orderId: "wx-00000000-0000-4000-8000-000000000003" })).rejects.toThrow("already assigned");
    expect((await entitlements.readEntitlement(order.customerId)).memberships).toHaveLength(1);
  });

  it("does not create membership periods for credit-only products", async () => {
    const entitlements = fixture();
    const fulfillment = createGuaiWechatFulfillment({
      localModule: {
        state: "ready",
        async grantVerifiedPayment(_input: VerifiedPaymentGrant) { return { lotId: "lot-1", reused: false }; },
      },
      entitlements,
    });
    await fulfillment.onVerifiedPaid({ ...order, kind: "credits", durationMonths: undefined }, new AbortController().signal);
    expect((await fulfillment.readEntitlement(order.customerId)).memberships).toEqual([]);
  });
});
