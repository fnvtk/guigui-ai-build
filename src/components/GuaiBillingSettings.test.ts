// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GuaiBillingCatalog, GuaiCheckoutOrder } from "../../shared/guai-billing";

const fixture = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/state/store", () => ({ api: fixture.api }));

import { GuaiBillingSettings } from "./GuaiBillingSettings";

const SKU = "pro-monthly";
const KEY = "123e4567-e89b-12d3-a456-426614174000";
const catalog: GuaiBillingCatalog = {
  configured: true,
  catalogConnected: true,
  checkoutReady: true,
  plans: [{ skuId: SKU, name: "专业版", displayPrice: "¥198/月", description: "8,000积分/月", availability: "available" }],
};
const created: GuaiCheckoutOrder = { orderId: "order-1", skuId: SKU, status: "created", checkoutUrl: "https://pay.example.test/checkout/1" };
let host: HTMLDivElement;
let root: Root;
const settle = () => act(async () => { for (let turn = 0; turn < 10; turn += 1) await Promise.resolve(); });
const text = () => host.textContent ?? "";
const button = (label: string) => [...host.querySelectorAll("button")].find((element) => element.textContent?.trim() === label);
const mount = async () => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(createElement(GuaiBillingSettings)));
  await settle();
};
const apiCalls = () => fixture.api.mock.calls as Array<[string, RequestInit | undefined]>;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.api.mockReset();
  (window as unknown as { ogb: unknown }).ogb = {};
  vi.stubGlobal("crypto", { randomUUID: vi.fn(() => KEY) });
  fixture.api.mockImplementation(async (path: string) => {
    if (path === "/api/guai-billing/catalog") return { configured: false, catalogConnected: false, checkoutReady: false, catalogStatus: "not_configured", plans: [] } satisfies GuaiBillingCatalog;
    if (path === "/api/guai-billing/membership") return { active: false, activeUntil: null, memberships: [] };
    throw new Error(`unexpected API ${path}`);
  });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("乖乖会员设置", () => {
  it("未配置时只展示注明来源的参考价，所有购买入口禁用", async () => {
    await mount();
    expect(text()).toContain("只读参考价；支付服务尚未配置，暂不可购买。");
    expect(text()).toContain("卡若AI会员页");
    expect(text()).toContain("¥19.8/月");
    expect([...host.querySelectorAll("button")].filter((item) => item.textContent === "暂不可购买").every((item) => item.disabled)).toBe(true);
    expect(apiCalls().some(([path]) => path === "/api/guai-billing/checkout")).toBe(false);
  });

  it("不再显示本机支付模块或商户证书入口", async () => {
    await mount();
    expect(text()).not.toContain("本机支付模块");
    expect(text()).not.toContain("微信收款配置");
    expect(text()).not.toContain("商户证书");
    expect(apiCalls().every(([path]) => !path.includes("/wechat/") && !path.includes("/local/") && path !== "/api/guai-billing/config")).toBe(true);
  });

  it("只在卡若AI目录确认可购买时启用套餐按钮", async () => {
    fixture.api.mockImplementation(async (path: string) => {
      if (path === "/api/guai-billing/catalog") return { ...catalog, checkoutReady: false };
      if (path === "/api/guai-billing/membership") return { active: false, activeUntil: null, memberships: [] };
      throw new Error(`unexpected API ${path}`);
    });
    await mount();
    expect(text()).toContain("卡若AI支付服务未就绪，暂不可购买。");
    expect([...host.querySelectorAll("button")].filter((item) => item.textContent === "暂不可购买").every((item) => item.disabled)).toBe(true);
  });

  it("创建订单报错时不报成功，并在同一次重试复用幂等键", async () => {
    let attempts = 0;
    fixture.api.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/api/guai-billing/catalog") return catalog;
      if (path === "/api/guai-billing/membership") return { active: false, activeUntil: null, memberships: [] };
      if (path === "/api/guai-billing/checkout" && init?.method === "POST") {
        attempts += 1;
        if (attempts === 1) throw new Error("network timeout");
        return created;
      }
      if (path === "/api/guai-billing/checkout/order-1") return { ...created, status: "pending", checkoutUrl: undefined };
      throw new Error(`unexpected API ${path}`);
    });
    await mount();
    await act(async () => button("选择套餐")!.click());
    await settle();
    expect(text()).toContain("network timeout");
    await act(async () => button("选择套餐")!.click());
    await settle();
    const posts = apiCalls().filter(([path, init]) => path === "/api/guai-billing/checkout" && init?.method === "POST");
    expect(posts).toHaveLength(2);
    expect(posts.map(([, init]) => JSON.parse(String(init?.body)))).toEqual([
      { skuId: SKU, idempotencyKey: KEY },
      { skuId: SKU, idempotencyKey: KEY },
    ]);
    expect(text()).toContain("处理中");
  });

  it("只把查单接口返回的状态作为已支付确认", async () => {
    fixture.api.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/api/guai-billing/catalog") return catalog;
      if (path === "/api/guai-billing/membership") return { active: true, activeUntil: "2026-12-15T00:00:00.000Z", memberships: [{ skuId: SKU, startsAt: "2026-11-01T00:00:00.000Z", endsAt: "2026-12-15T00:00:00.000Z" }] };
      if (path === "/api/guai-billing/checkout" && init?.method === "POST") return created;
      if (path === "/api/guai-billing/checkout/order-1") return { ...created, status: "paid", fulfillmentStatus: "fulfilled", checkoutUrl: undefined };
      throw new Error(`unexpected API ${path}`);
    });
    await mount();
    await act(async () => button("选择套餐")!.click());
    await settle();
    expect(text()).toContain("已付款，会员入账已完成；会员状态以权益读取为准");
    expect(text()).toContain("会员状态：已开通");
  });
});
