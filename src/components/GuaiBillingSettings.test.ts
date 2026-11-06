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
const WECHAT_DIRECTORY = "/Users/karuo/Documents/开发/4、模块/支付模块/支付/微信";
const catalog: GuaiBillingCatalog = {
  configured: true, catalogConnected: true, checkoutReady: true,
  plans: [{ skuId: SKU, name: "专业版", displayPrice: "¥198/月", description: "8,000积分/月", availability: "available" }],
};
const created: GuaiCheckoutOrder = { orderId: "order-1", skuId: SKU, status: "created", checkoutUrl: "https://pay.example.test/checkout/1" };
const wechatReady = {
  enabled: true, appId: "app", merchantId: "merchant", merchantCertificatePath: "/cert.pem", privateKeyPath: "/key.pem",
  platformCertificatePath: "/platform.pem", platformSerialNo: "serial", notifyUrl: "https://notify.example.test",
  apiV3KeyConfigured: true, ready: true, missingFields: [],
};
type MockWechatConfig = {
  enabled: boolean;
  appId: string;
  merchantId: string;
  merchantCertificatePath: string;
  privateKeyPath: string;
  platformCertificatePath: string;
  platformSerialNo: string;
  notifyUrl: string;
  apiV3KeyConfigured: boolean;
  ready: boolean;
  missingFields: string[];
};
let host: HTMLDivElement;
let root: Root;
let secureSave: ReturnType<typeof vi.fn>;
const settle = () => act(async () => { for (let turn = 0; turn < 10; turn += 1) await Promise.resolve(); });
const text = () => host.textContent ?? "";
const button = (label: string) => [...host.querySelectorAll("button")].find((element) => element.textContent?.trim() === label);
const mount = async () => {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(createElement(GuaiBillingSettings)));
  await settle();
};
const apiCalls = () => fixture.api.mock.calls as Array<[string, RequestInit | undefined]>;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.api.mockReset();
  secureSave = vi.fn().mockResolvedValue({});
  (window as unknown as { ogb: unknown }).ogb = { setCredential: secureSave, pickFolder: vi.fn(async (path: string) => path) };
  vi.stubGlobal("crypto", { randomUUID: vi.fn(() => KEY) });
  fixture.api.mockImplementation(async (path: string) => {
    if (path === "/api/guai-billing/config") return { apiUrl: "", catalogPath: "", statusPath: "/v1/orders/{orderId}", returnTargetId: "", tokenConfigured: false };
    if (path === "/api/guai-billing/catalog") return { configured: false, catalogConnected: false, checkoutReady: false, catalogStatus: "not_configured", plans: [] } satisfies GuaiBillingCatalog;
    if (path === "/api/guai-billing/wechat/config") return {
      enabled: false, appId: "", merchantId: "", merchantCertificatePath: "", privateKeyPath: "", platformCertificatePath: "", platformSerialNo: "", notifyUrl: "",
      apiV3KeyConfigured: false, ready: false, missingFields: ["appId", "merchantId", "apiV3Key"],
    };
    if (path === "/api/guai-billing/membership") return { active: false, activeUntil: null, memberships: [] };
    throw new Error(`unexpected API ${path}`);
  });
});

afterEach(() => {
  act(() => root.unmount()); host.remove(); vi.unstubAllGlobals();
});

describe("乖乖会员设置", () => {
  it("未配置时只展示注明来源的参考价，所有购买入口禁用", async () => {
    await mount();
    expect(text()).toContain("只读参考价；支付服务尚未配置，暂不可购买。");
    expect(text()).toContain("卡若AI会员页");
    expect(text()).toContain("¥19.8/月");
    expect(text()).toContain("2,000积分/月");
    expect([...host.querySelectorAll("button")].filter((item) => item.textContent === "暂不可购买").every((item) => item.disabled)).toBe(true);
    expect(apiCalls().some(([path]) => path === "/api/guai-billing/checkout")).toBe(false);
  });

  it("创建订单报错时不报成功，并在同一次重试复用幂等键", async () => {
    let attempts = 0;
    fixture.api.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/api/guai-billing/config") return { localModulePath: "/authorized/payment-module", localModuleConnected: true };
      if (path === "/api/guai-billing/catalog") return catalog;
      if (path === "/api/guai-billing/balance") return { availableCredits: 0, reservedCredits: 0 };
      if (path === "/api/guai-billing/wechat/config") return wechatReady;
      if (path === "/api/guai-billing/checkout" && init?.method === "POST") {
        attempts += 1;
        if (attempts === 1) throw new Error("network timeout");
        return created;
      }
      if (path === "/api/guai-billing/checkout/order-1") return { ...created, status: "pending", checkoutUrl: undefined };
      throw new Error(`unexpected API ${path}`);
    });
    await mount();
    await act(async () => button("选择套餐")!.click()); await settle();
    expect(text()).toContain("network timeout");
    expect(text()).not.toContain("服务端已确认支付");
    await act(async () => button("选择套餐")!.click()); await settle();
    const posts = apiCalls().filter(([path, init]) => path === "/api/guai-billing/checkout" && init?.method === "POST");
    expect(posts).toHaveLength(2);
    const bodies = posts.map(([, init]) => JSON.parse(String(init?.body)) as Record<string, string>);
    expect(bodies[0]).toEqual({ skuId: SKU, idempotencyKey: KEY });
    expect(bodies[1]).toEqual(bodies[0]);
    expect(Object.keys(bodies[1]).sort()).toEqual(["idempotencyKey", "skuId"]);
    expect(apiCalls().some(([path]) => path === "/api/guai-billing/checkout/order-1")).toBe(true);
    expect(text()).toContain("处理中");
    expect(text()).not.toContain("服务端已确认支付");
    expect(host.querySelector('a[href="https://pay.example.test/checkout/1"]')?.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("只把查单接口返回的状态作为已支付确认", async () => {
    fixture.api.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/api/guai-billing/config") return { localModulePath: "/authorized/payment-module", localModuleConnected: true };
      if (path === "/api/guai-billing/catalog") return catalog;
      if (path === "/api/guai-billing/wechat/config") return wechatReady;
      if (path === "/api/guai-billing/membership") return { active: true, activeUntil: "2026-12-15T00:00:00.000Z", memberships: [{ skuId: SKU, startsAt: "2026-11-01T00:00:00.000Z", endsAt: "2026-12-15T00:00:00.000Z" }] };
      if (path === "/api/guai-billing/checkout" && init?.method === "POST") return created;
      if (path === "/api/guai-billing/checkout/order-1") return { ...created, status: "paid", fulfillmentStatus: "fulfilled", checkoutUrl: undefined };
      throw new Error(`unexpected API ${path}`);
    });
    await mount();
    await act(async () => button("选择套餐")!.click()); await settle();
    expect(text()).toContain("已付款，会员入账已完成；会员状态以权益读取为准");
    expect(apiCalls().filter(([path]) => path === "/api/guai-billing/checkout/order-1")).toHaveLength(1);
    expect(text()).toContain("会员状态：已开通");
    expect(apiCalls().filter(([path]) => path === "/api/guai-billing/membership")).toHaveLength(2);
  });

  it("常规刷新会重新读取会员状态和有效期", async () => {
    let active = false;
    fixture.api.mockImplementation(async (path: string) => {
      if (path === "/api/guai-billing/config") return { localModulePath: "/authorized/payment-module", localModuleConnected: false };
      if (path === "/api/guai-billing/catalog") return { configured: false, catalogConnected: false, checkoutReady: false, plans: [] };
      if (path === "/api/guai-billing/wechat/config") return { ...wechatReady, enabled: false, ready: false, apiV3KeyConfigured: false, missingFields: ["apiV3Key"] };
      if (path === "/api/guai-billing/membership") return { active, activeUntil: active ? "2026-12-15T00:00:00.000Z" : null, memberships: [] };
      throw new Error(`unexpected API ${path}`);
    });
    await mount();
    expect(text()).toContain("会员状态：未开通");
    active = true;
    await act(async () => button("刷新套餐")!.click()); await settle();
    expect(text()).toContain("会员状态：已开通");
    expect(text()).toContain("有效期至 2026年12月15日");
    expect(apiCalls().filter(([path]) => path === "/api/guai-billing/membership")).toHaveLength(2);
  });

  it("已付款但入账待完成时可刷新原订单，只有服务端回读fulfilled才显示入账完成", async () => {
    let fulfillmentStatus: "pending" | "fulfilled" = "pending";
    fixture.api.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/api/guai-billing/config") return { localModulePath: "/authorized/payment-module", localModuleConnected: false };
      if (path === "/api/guai-billing/catalog") return catalog;
      if (path === "/api/guai-billing/wechat/config") return wechatReady;
      if (path === "/api/guai-billing/membership") return { active: false, activeUntil: null, memberships: [] };
      if (path === "/api/guai-billing/checkout" && init?.method === "POST") return created;
      if (path === "/api/guai-billing/checkout/order-1") return { ...created, status: "paid", fulfillmentStatus };
      throw new Error(`unexpected API ${path}`);
    });
    await mount();
    await act(async () => button("选择套餐")!.click()); await settle();
    expect(text()).toContain("已付款，会员入账待完成");
    expect(text()).toContain("会员状态：未开通");
    expect(text()).not.toContain("会员入账已完成");
    fulfillmentStatus = "fulfilled";
    await act(async () => button("刷新订单状态")!.click()); await settle();
    expect(text()).toContain("已付款，会员入账已完成；会员状态以权益读取为准");
    expect(text()).toContain("会员状态：未开通");
    expect(apiCalls().filter(([path, init]) => path === "/api/guai-billing/checkout" && init?.method === "POST")).toHaveLength(1);
    expect(apiCalls().filter(([path]) => path === "/api/guai-billing/checkout/order-1")).toHaveLength(2);
  });

  it("会员状态读取失败时显示未知，不推断为未开通", async () => {
    fixture.api.mockImplementation(async (path: string) => {
      if (path === "/api/guai-billing/config") return { localModulePath: "/authorized/payment-module", localModuleConnected: false };
      if (path === "/api/guai-billing/catalog") return { configured: false, catalogConnected: false, checkoutReady: false, plans: [] };
      if (path === "/api/guai-billing/wechat/config") return { ...wechatReady, enabled: false, ready: false, apiV3KeyConfigured: false, missingFields: ["apiV3Key"] };
      if (path === "/api/guai-billing/membership") throw new Error("membership service unavailable");
      throw new Error(`unexpected API ${path}`);
    });
    await mount();
    expect(text()).toContain("会员状态暂不可用；尚未判断为未开通。");
    expect(text()).not.toContain("会员状态：未开通");
  });

  it("保留Native微信收银台地址并本地渲染二维码，订单状态仍以服务端查单为准", async () => {
    const nativeUrl = "weixin://wxpay/bizpayurl?pr=abc123";
    let remoteStatus: GuaiCheckoutOrder["status"] = "pending";
    let fulfillmentStatus: GuaiCheckoutOrder["fulfillmentStatus"] = "pending";
    fixture.api.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/api/guai-billing/config") return { localModulePath: "/authorized/payment-module", localModuleConnected: false };
      if (path === "/api/guai-billing/catalog") return catalog;
      if (path === "/api/guai-billing/wechat/config") return wechatReady;
      if (path === "/api/guai-billing/checkout" && init?.method === "POST") return { ...created, checkoutUrl: nativeUrl };
      if (path === "/api/guai-billing/checkout/order-1") return { ...created, status: remoteStatus, fulfillmentStatus, checkoutUrl: undefined };
      throw new Error(`unexpected API ${path}`);
    });
    await mount();
    await act(async () => button("选择套餐")!.click()); await settle();
    expect(text()).toContain("处理中");
    expect(host.querySelector("[data-wechat-qr] svg title")?.textContent).toBe("微信扫码支付二维码");
    expect(host.querySelector('a[href^="weixin:"]')).toBeNull();
    remoteStatus = "paid";
    fulfillmentStatus = "fulfilled";
    await act(async () => button("刷新订单状态")!.click()); await settle();
    expect(text()).toContain("已付款，会员入账已完成；会员状态以权益读取为准");
    expect(host.querySelector("[data-wechat-qr] svg")).not.toBeNull();
  });

  it.each([
    "javascript:alert(1)",
    "file:///tmp/secret",
    "weixin://wxpay.evil/bizpayurl?pr=x",
    "weixin://wxpay/other?pr=x",
    "weixin://wxpay/bizpayurl?pr=",
    "weixin://user@wxpay/bizpayurl?pr=x",
    "weixin://wxpay:80/bizpayurl?pr=x",
    "weixin://wxpay/bizpayurl?pr=x&redirect=https://evil.test",
  ])("拒绝不符合协议的checkout地址 %s", async (unsafeUrl) => {
    fixture.api.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/api/guai-billing/config") return { localModulePath: "/authorized/payment-module", localModuleConnected: false };
      if (path === "/api/guai-billing/catalog") return catalog;
      if (path === "/api/guai-billing/wechat/config") return wechatReady;
      if (path === "/api/guai-billing/checkout" && init?.method === "POST") return { ...created, checkoutUrl: unsafeUrl };
      if (path === "/api/guai-billing/checkout/order-1") return { ...created, status: "pending", checkoutUrl: unsafeUrl };
      throw new Error(`unexpected API ${path}`);
    });
    await mount();
    await act(async () => button("选择套餐")!.click()); await settle();
    expect(host.querySelector("[data-wechat-qr]")).toBeNull();
    expect(host.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(host.querySelector('a[href^="file:"]')).toBeNull();
    expect(host.querySelector('a[href^="weixin:"]')).toBeNull();
    expect(text()).not.toContain("前往安全支付");
    expect(text()).toContain("处理中");
  });

  it("当前商户配置变化不改写历史查单事实，查单失败时则恢复未确认状态", async () => {
    let wechat: MockWechatConfig = { ...wechatReady };
    let remoteStatus: GuaiCheckoutOrder["status"] = "pending";
    let fulfillmentStatus: GuaiCheckoutOrder["fulfillmentStatus"] = "pending";
    let orderReadFails = false;
    fixture.api.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/api/guai-billing/config") return { localModulePath: "/authorized/payment-module", localModuleConnected: true };
      if (path === "/api/guai-billing/catalog") return catalog;
      if (path === "/api/guai-billing/balance") return { availableCredits: 0, reservedCredits: 0 };
      if (path === "/api/guai-billing/wechat/config") return wechat;
      if (path === "/api/guai-billing/checkout" && init?.method === "POST") return created;
      if (path === "/api/guai-billing/checkout/order-1") {
        if (orderReadFails) throw new Error("status unavailable");
        return { ...created, status: remoteStatus, fulfillmentStatus };
      }
      throw new Error(`unexpected API ${path}`);
    });
    await mount();
    await act(async () => button("选择套餐")!.click()); await settle();
    expect(text()).toContain("处理中");
    wechat = { ...wechatReady, ready: false, enabled: false, missingFields: ["apiV3Key"] };
    remoteStatus = "paid";
    fulfillmentStatus = "fulfilled";
    await act(async () => button("刷新套餐")!.click()); await settle();
    await act(async () => button("刷新订单状态")!.click()); await settle();
    expect(text()).toContain("已付款，会员入账已完成；会员状态以权益读取为准");
    orderReadFails = true;
    await act(async () => button("刷新订单状态")!.click()); await settle();
    expect(text()).toContain("正在等待服务端查单");
    expect(text()).not.toContain("已付款，会员入账已完成；会员状态以权益读取为准");
  });

  it("只连接主机固定的本机模块，回读真实余额且不向网页暴露密钥", async () => {
    let connected = false;
    fixture.api.mockImplementation(async (path: string) => {
      if (path === "/api/guai-billing/config") return { localModulePath: "/authorized/payment-module", localModuleConnected: connected };
      if (path === "/api/guai-billing/catalog") return { ...catalog, checkoutReady: false, plans: catalog.plans.map(plan => ({ ...plan, availability: "reference_only" })) };
      if (path === "/api/guai-billing/wechat/config") return { ...wechatReady, enabled: false, ready: false, apiV3KeyConfigured: false, missingFields: ["apiV3Key"] };
      if (path === "/api/guai-billing/local/connect") { connected = true; return { connected: true }; }
      if (path === "/api/guai-billing/balance") return { availableCredits: 17, reservedCredits: 3 };
      throw new Error(`unexpected API ${path}`);
    });
    await mount();
    expect(host.querySelector<HTMLInputElement>('input[type="password"]')?.disabled).toBe(false);
    expect(host.querySelector<HTMLDetailsElement>("[data-wechat-billing-config]")?.open).toBe(false);
    await act(async () => button("连接本机支付模块")!.click()); await settle();
    expect(apiCalls().find(([path]) => path === "/api/guai-billing/local/connect")?.[1]?.body).toBe("{}");
    expect(text()).toContain("可用积分 17");
    expect(text()).toContain("预占积分 3");
    expect(button("重新检查本机模块")).toBeDefined();
    expect(secureSave).not.toHaveBeenCalled();
    expect(apiCalls().every(([, init]) => init?.method !== "PUT")).toBe(true);
    expect([...host.querySelectorAll("button")].filter(item => item.textContent === "暂不可购买").every(item => item.disabled)).toBe(true);
  });

  it("微信收款配置默认折叠并禁用下单；公开配置PUT不含APIv3密钥，密钥只走桌面安全存储", async () => {
    let config = {
      enabled: false, appId: "", merchantId: "", merchantCertificatePath: "", privateKeyPath: "", platformCertificatePath: "", platformSerialNo: "", notifyUrl: "",
      apiV3KeyConfigured: false, ready: false, missingFields: ["appId", "merchantId", "merchantCertificatePath", "privateKeyPath", "platformCertificatePath", "platformSerialNo", "notifyUrl", "apiV3Key"],
    };
    let keyConfigured = false;
    fixture.api.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/api/guai-billing/config") return { localModulePath: "/authorized/payment-module", localModuleConnected: true };
      if (path === "/api/guai-billing/catalog") return catalog;
      if (path === "/api/guai-billing/balance") return { availableCredits: 0, reservedCredits: 0 };
      if (path === "/api/guai-billing/wechat/config" && init?.method === "PUT") {
        const publicFields = JSON.parse(String(init.body));
        expect(Object.keys(publicFields).sort()).toEqual(["appId", "enabled", "merchantCertificatePath", "merchantId", "notifyUrl", "platformCertificatePath", "platformSerialNo", "privateKeyPath"]);
        config = { ...config, ...publicFields, apiV3KeyConfigured: keyConfigured, ready: keyConfigured && Object.values(publicFields).every((value) => typeof value === "boolean" || (typeof value === "string" && value.trim().length > 0)), missingFields: keyConfigured ? [] : ["apiV3Key"] };
        return config;
      }
      if (path === "/api/guai-billing/wechat/config") {
        const hasPublicFields = [config.appId, config.merchantId, config.merchantCertificatePath, config.privateKeyPath, config.platformCertificatePath, config.platformSerialNo, config.notifyUrl].every(Boolean);
        return { ...config, apiV3KeyConfigured: keyConfigured, ready: keyConfigured && hasPublicFields, missingFields: keyConfigured && hasPublicFields ? [] : keyConfigured ? [] : ["apiV3Key"] };
      }
      throw new Error(`unexpected API ${path}`);
    });
    secureSave.mockImplementation(async (slot: string, value: string) => {
      expect(slot).toBe("guaiBillingWechatApiV3Key");
      expect(value).toBe("private-api-v3-secret");
      keyConfigured = true;
      return {};
    });
    await mount();
    const panel = host.querySelector<HTMLDetailsElement>("[data-wechat-billing-config]")!;
    expect(panel.open).toBe(false);
    expect(text()).toContain("微信收款配置");
    expect(text()).toContain("配置尚未完整");
    expect(text()).toContain("微信应用 AppID");
    expect(text()).not.toContain("已付款，会员入账已完成；会员状态以权益读取为准");
    expect(text()).not.toContain("最近订单");
    expect([...host.querySelectorAll("button")].filter(item => item.textContent === "暂不可购买").every(item => item.disabled)).toBe(true);
    expect(host.querySelector<HTMLInputElement>("[data-wechat-enabled]")?.checked).toBe(false);
    expect(host.querySelector<HTMLInputElement>("[data-wechat-enabled]")?.disabled).toBe(true);

    const updateField = async (name: string, value: string) => {
      const input = host.querySelector<HTMLInputElement>(`[data-wechat-field="${name}"]`)!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };
    const fields: Record<string, string> = {
      appId: "wx-app", merchantId: "merchant-123", merchantCertificatePath: "/local/cert.pem", privateKeyPath: "/local/key.pem",
      platformCertificatePath: "/local/platform.pem", platformSerialNo: "serial-123", notifyUrl: "https://example.test/notify",
    };
    for (const [name, value] of Object.entries(fields)) await updateField(name, value);
    await act(async () => button("保存微信配置")!.click()); await settle();
    expect(secureSave).not.toHaveBeenCalled();
    expect(host.querySelector<HTMLInputElement>("[data-wechat-enabled]")?.checked).toBe(false);
    const keyInput = host.querySelector<HTMLInputElement>("[data-wechat-api-v3-key]")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(keyInput, "private-api-v3-secret");
      keyInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => button("保存APIv3密钥")!.click()); await settle();
    expect(secureSave).toHaveBeenCalledExactlyOnceWith("guaiBillingWechatApiV3Key", "private-api-v3-secret");
    expect(apiCalls().every(([, init]) => !String(init?.body ?? "").includes("private-api-v3-secret"))).toBe(true);
    expect(host.querySelector<HTMLInputElement>("[data-wechat-enabled]")?.disabled).toBe(false);
    expect(host.querySelector<HTMLInputElement>("[data-wechat-enabled]")?.checked).toBe(false);
    expect(apiCalls().filter(([path, init]) => path === "/api/guai-billing/checkout" && init?.method === "POST")).toHaveLength(0);
  });

  it("只能从指定本机目录导入微信证书，并在导入后重新读取应用私有证书路径", async () => {
    let imported = false;
    const pickFolder = vi.fn(async (path: string) => path);
    (window as unknown as { ogb: unknown }).ogb = { setCredential: secureSave, pickFolder };
    fixture.api.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/api/guai-billing/config") return { localModulePath: "/authorized/payment-module", localModuleConnected: true };
      if (path === "/api/guai-billing/catalog") return { ...catalog, checkoutReady: false, plans: catalog.plans.map(plan => ({ ...plan, availability: "reference_only" })) };
      if (path === "/api/guai-billing/wechat/import" && init?.method === "POST") { imported = true; return { imported: true }; }
      if (path === "/api/guai-billing/wechat/config") return imported
        ? { ...wechatReady, enabled: false, merchantCertificatePath: "/app-private/wechat/merchant.pem", privateKeyPath: "/app-private/wechat/private.pem", ready: true }
        : { ...wechatReady, enabled: false, ready: false, apiV3KeyConfigured: false, missingFields: ["apiV3Key"] };
      throw new Error(`unexpected API ${path}`);
    });
    await mount();
    await act(async () => button("导入本机微信证书")!.click()); await settle();
    expect(pickFolder).toHaveBeenCalledExactlyOnceWith(WECHAT_DIRECTORY);
    expect(apiCalls().find(([path]) => path === "/api/guai-billing/wechat/import")?.[1]).toMatchObject({ method: "POST", body: "{}" });
    expect(apiCalls().findIndex(([path]) => path === "/api/guai-billing/wechat/import")).toBeLessThan(apiCalls().findIndex(([path], index) => path === "/api/guai-billing/wechat/config" && index > 2));
    expect(text()).toContain("证书已导入应用私有目录");
    expect(host.querySelector<HTMLInputElement>('[data-wechat-field="merchantCertificatePath"]')?.value).toBe("/app-private/wechat/merchant.pem");
    expect(host.querySelector<HTMLInputElement>('[data-wechat-field="privateKeyPath"]')?.value).toBe("/app-private/wechat/private.pem");
    expect(secureSave).not.toHaveBeenCalled();
    expect(apiCalls().every(([, init]) => !String(init?.body ?? "").includes("PRIVATE KEY"))).toBe(true);
    pickFolder.mockResolvedValueOnce("/unexpected/other-directory");
    await act(async () => button("导入本机微信证书")!.click()); await settle();
    expect(apiCalls().filter(([path]) => path === "/api/guai-billing/wechat/import")).toHaveLength(1);
    expect(text()).toContain("未导入其他目录");
  });
});
