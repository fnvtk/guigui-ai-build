import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createGuaiBilling } from "./guai-billing.ts";
import { GUAI_BILLING_REFERENCE_CATALOG, GuaiBillingLocalModule } from "./guai-billing-local-module.ts";

const moduleDirectory = "/Users/karuo/Documents/开发/4、模块/支付模块/10_运行时_统一收费核心";
const directories: string[] = [];
const modules: GuaiBillingLocalModule[] = [];
afterEach(async () => {
  for (const localModule of modules.splice(0)) await localModule.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function fixture(options: Partial<ConstructorParameters<typeof GuaiBillingLocalModule>[0]> = {}) {
  const privateDirectory = mkdtempSync(join(tmpdir(), "omb-local-billing-"));
  directories.push(privateDirectory);
  const localModule = new GuaiBillingLocalModule({
    enabled: true,
    moduleDirectory,
    privateDirectory: join(privateDirectory, "runtime"),
    appId: "openmausbot-guai-local",
    tenantId: "local-machine",
    catalog: GUAI_BILLING_REFERENCE_CATALOG,
    ...options,
  });
  modules.push(localModule);
  return { localModule, privateDirectory };
}

describe("GuaiBillingLocalModule", () => {
  it("starts the actual local Python service, reads its reference catalog and balance, and closes it", async () => {
    const { localModule, privateDirectory } = fixture();
    const connection = await localModule.start();
    expect(localModule.state).toBe("ready");
    expect(connection.apiUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(connection.catalogPath).toBe("/v1/catalog");
    expect(connection.balancePath).toBe("/v1/accounts/{customerId}/balance");

    const storedConfig = readFileSync(join(privateDirectory, "runtime", "config.private.json"), "utf8");
    expect(storedConfig).not.toContain(connection.apiToken);
    expect(statSync(join(privateDirectory, "runtime", "config.private.json")).mode & 0o777).toBe(0o600);
    expect(statSync(join(privateDirectory, "runtime", "billing-core.sqlite")).mode & 0o777).toBe(0o600);

    const billing = createGuaiBilling({
      config: () => connection,
      orders: { get: async () => null, getByIdempotencyKey: async () => null, createIfAbsent: async () => "created", update: async () => undefined },
    });
    const catalog = await billing.catalog();
    expect(catalog).toMatchObject({ catalogConnected: true, paymentChannelsLiveVerified: false, checkoutReady: false, catalogStatus: "reference_only" });
    expect(catalog.plans).toHaveLength(3);
    expect(catalog.plans.every((plan) => plan.availability === "reference_only" && plan.checkoutEnabled === false)).toBe(true);
    expect(catalog.plans.map((plan) => [plan.skuId, plan.amountMinor, plan.includedCredits])).toEqual([
      ["guai-ai-standard-monthly", 1980, 2000], ["guai-ai-pro-monthly", 19800, 8000], ["guai-ai-super-monthly", 198000, 50000],
    ]);
    expect(await billing.balance("customer-1")).toEqual({ availableCredits: 0, reservedCredits: 0 });
    await expect(billing.checkout("customer-1", "guai-ai-pro-monthly", "module-checkout-key-123456")).rejects.toMatchObject({ status: 503, message: "本地支付渠道尚未验证，暂不能创建订单" });

    await localModule.close();
    expect(localModule.state).toBe("stopped");
  });

  it("reports disabled and missing-module states without creating a process", async () => {
    const disabled = fixture({ enabled: false });
    await expect(disabled.localModule.start()).rejects.toMatchObject({ code: "LOCAL_MODULE_DISABLED" });
    expect(disabled.localModule.state).toBe("stopped");

    const missing = fixture({ moduleDirectory: join(disabled.privateDirectory, "missing") });
    await expect(missing.localModule.start()).rejects.toMatchObject({ code: "LOCAL_MODULE_FILES_MISSING" });
    expect(missing.localModule.state).toBe("failed");
    expect(missing.localModule.failure).toBe("找不到本地收费模块文件");
  });

  it("grants only through the host's private Python Core call and deduplicates by provider transaction ID", async () => {
    const { localModule } = fixture();
    const connection = await localModule.start();
    const payment = { customerId: "verified-customer", credits: 8000, transactionId: "4200000000000000000000000009", kind: "subscription", expiresAt: "2099-02-28T04:30:00.000Z" };
    const first = await localModule.grantVerifiedPayment(payment);
    const retry = await localModule.grantVerifiedPayment(payment);
    expect(first.reused).toBe(false);
    expect(retry).toEqual({ ...first, reused: true });
    const billing = createGuaiBilling({
      config: () => connection,
      orders: { get: async () => null, getByIdempotencyKey: async () => null, createIfAbsent: async () => "created", update: async () => undefined },
    });
    expect(await billing.balance("verified-customer")).toEqual({ availableCredits: 8000, reservedCredits: 0 });
    await expect(localModule.grantVerifiedPayment({ ...payment, customerId: "another-customer" })).rejects.toMatchObject({ code: "VERIFIED_GRANT_FAILED" });
    await expect(localModule.grantVerifiedPayment({ ...payment, expiresAt: "2099-03-28T04:30:00.000Z" })).rejects.toMatchObject({ code: "VERIFIED_GRANT_FAILED" });
    await localModule.grantVerifiedPayment({ customerId: "verified-customer", credits: 2000, transactionId: "4200000000000000000000000011", kind: "subscription", expiresAt: "2000-01-01T00:00:00.000Z" });
    expect(await billing.balance("verified-customer")).toEqual({ availableCredits: 8000, reservedCredits: 0 });
  });

  it("keeps the event loop responsive and times out while module file access is pending", async () => {
    const delayed = fixture({
      startupTimeoutMs: 90,
      readModuleFile: (_path, signal) => new Promise<string>((_resolveRead, reject) => {
        signal.addEventListener("abort", () => reject(new Error("read aborted")), { once: true });
      }),
    });
    const ticks: number[] = [];
    const interval = setInterval(() => ticks.push(Date.now()), 5);
    const startedAt = Date.now();
    try {
      await expect(delayed.localModule.start()).rejects.toMatchObject({ code: "LOCAL_MODULE_PREP_TIMEOUT", message: "读取本地收费模块超时，请检查 macOS 文件夹访问授权" });
    } finally { clearInterval(interval); }
    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(ticks.length).toBeGreaterThan(0);
    expect(delayed.localModule.state).toBe("failed");
    expect(existsSync(join(delayed.privateDirectory, "runtime"))).toBe(false);
  });
});
