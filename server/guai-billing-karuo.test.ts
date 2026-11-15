import { describe, expect, it, vi } from "vitest";

import { createGuaiBilling, type GuaiBillingConfig, type GuaiBillingOrderRecord, type GuaiBillingOrderStore } from "./guai-billing.ts";

function store(): GuaiBillingOrderStore {
  const records = new Map<string, GuaiBillingOrderRecord>();
  return {
    async get(customerId, orderId) { return [...records.values()].find((record) => record.customerId === customerId && record.orderId === orderId) ?? null; },
    async getByIdempotencyKey(customerId, key) { return records.get(`${customerId}:${key}`) ?? null; },
    async createIfAbsent(record) {
      const key = `${record.customerId}:${record.idempotencyKey}`;
      if (records.has(key)) return "exists";
      records.set(key, record);
      return "created";
    },
    async update(record) { records.set(`${record.customerId}:${record.idempotencyKey}`, record); },
  };
}

const config: GuaiBillingConfig = { provider: "karuo-ai", sessionCookie: "sid=fixture" };

function reply(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

describe("卡若AI支付适配", () => {
  it("没有会话也能读取公开套餐，但保持不可下单", async () => {
    const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("cookie")).toBeNull();
      return reply({ ok: true, plans: [{ id: "free", name: "免费版", basePrice: 0 }], channelStatus: { alipay: true } });
    });
    const billing = createGuaiBilling({ config: () => ({ provider: "karuo-ai" }), orders: store(), fetch: fetcher });
    await expect(billing.catalog()).resolves.toMatchObject({ catalogConnected: true, checkoutReady: false, message: "卡若AI支付服务会话未授权；当前仅可读取公开套餐目录" });
  });

  it("没有显式目录路径也读取套餐，并且不会把银行渠道误判成支付宝可购买", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("https://kr-ai.quwanzhi.com/api/billing/plans");
      expect(new Headers(init?.headers).get("cookie")).toBe("sid=fixture");
      return reply({ ok: true, plans: [{ id: "normal", name: "普通版", basePrice: 19.8 }], channelStatus: { alipay: false, bank: true } });
    });
    const billing = createGuaiBilling({ config: () => config, orders: store(), fetch: fetcher });
    await expect(billing.catalog()).resolves.toMatchObject({ catalogConnected: true, checkoutReady: false, paymentChannelsLiveVerified: false, plans: [{ skuId: "normal", availability: "reference_only", checkoutEnabled: false }] });
  });

  it("使用会话 Cookie 创建订单，并用卡若订单回读确认已支付", async () => {
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      expect(new Headers(init?.headers).get("cookie")).toBe("sid=fixture");
      if (url.endsWith("/api/billing/plans")) return reply({ ok: true, plans: [{ id: "normal", name: "普通版", basePrice: 19.8 }], channelStatus: { alipay: true } });
      if (url.endsWith("/api/billing/create-order")) {
        expect(JSON.parse(String(init?.body))).toMatchObject({ kind: "subscription", planId: "normal", provider: "alipay" });
        return reply({ ok: true, orderSn: "KR20261115150221430889", payment: { url: "https://pay.example.test/1" } });
      }
      if (url.endsWith("/api/billing/subscription")) return reply({ ok: true, subscription: { planId: "normal", status: "active", renewAt: "2026-12-15T00:00:00.000Z" } });
      expect(url).toBe("https://kr-ai.quwanzhi.com/api/billing/orders");
      return reply({ ok: true, orders: [{ orderSn: "KR20261115150221430889", status: "paid" }] });
    });
    const billing = createGuaiBilling({ config: () => config, orders: store(), fetch: fetcher });
    const created = await billing.checkout("customer-fixture", "normal", "idempotency-key-1234");
    expect(created).toMatchObject({ orderId: "KR20261115150221430889", skuId: "normal", status: "created", checkoutUrl: "https://pay.example.test/1" });
    await expect(billing.order("customer-fixture", created.orderId)).resolves.toMatchObject({ orderId: created.orderId, skuId: "normal", status: "paid" });
    await expect(billing.membership("customer-fixture")).resolves.toEqual({ active: true, activeUntil: "2026-12-15T00:00:00.000Z", memberships: [] });
  });
});
