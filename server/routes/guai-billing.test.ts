import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { GuaiBillingConfig } from "../guai-billing.ts";
import { GuaiBillingError } from "../guai-billing.ts";
import { json, readBody } from "../harness/http.ts";
import type { RequestAuth } from "../request-auth.ts";
import { createGuaiBillingRoutes } from "./guai-billing.ts";
import { dispatchRoutes } from "./table.ts";

const servers: Server[] = [];
afterEach(async () => Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done)))));

async function serve() {
  const checkout = vi.fn(async () => { throw new GuaiBillingError(503, "本地支付渠道尚未验证，暂不能创建订单"); });
  const balance = vi.fn(async (customerId: string | null) => {
    if (!customerId) throw new GuaiBillingError(401, "当前账号缺少可信客户身份");
    return { availableCredits: 0, reservedCredits: 0 };
  });
  const connectLocal = vi.fn(async () => undefined);
  const config: GuaiBillingConfig = { apiUrl: "http://127.0.0.1:43123", apiToken: "secret-local-token", localModulePath: "/fixed/payment/module", localModuleConnected: true };
  const routes = [createGuaiBillingRoutes({
    billing: {
      catalog: async () => ({ configured: true, catalogConnected: true, catalogStatus: "reference_only", paymentChannelsLiveVerified: false, checkoutReady: false, plans: [{ skuId: "guai-ai-pro-monthly", name: "专业版", availability: "reference_only", checkoutEnabled: false }] }),
      checkout,
      order: async () => { throw new GuaiBillingError(404, "订单不存在"); },
      balance,
    },
    getConfig: () => config,
    connectLocal,
    customerId: (auth) => auth.kind === "session" ? auth.session.userId ?? null : null,
  })];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const userId = req.headers["x-user"];
    const auth = { kind: "session", session: { userId: typeof userId === "string" ? userId : undefined }, via: "bearer", scopes: ["client"] } as unknown as RequestAuth;
    if (!await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody })) json(res, 404, {});
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, checkout, balance, connectLocal };
}

describe("guai billing local routes", () => {
  it("returns reference catalog and reads balance only for the host-resolved customer", async () => {
    const { base, balance } = await serve();
    const catalog = await fetch(`${base}/api/guai-billing/catalog`);
    expect(await catalog.json()).toMatchObject({ catalogConnected: true, catalogStatus: "reference_only", paymentChannelsLiveVerified: false, checkoutReady: false, plans: [{ availability: "reference_only", checkoutEnabled: false }] });
    const response = await fetch(`${base}/api/guai-billing/balance?customerId=forged`, { headers: { "x-user": "local-owner" } });
    expect(await response.json()).toEqual({ availableCredits: 0, reservedCredits: 0 });
    expect(balance).toHaveBeenCalledWith("local-owner");
  });

  it("rejects a client customer or price and surfaces the module's unverified payment refusal", async () => {
    const { base, checkout } = await serve();
    const forged = await fetch(`${base}/api/guai-billing/checkout`, { method: "POST", headers: { "content-type": "application/json", "x-user": "local-owner" }, body: JSON.stringify({ skuId: "guai-ai-pro-monthly", idempotencyKey: "local-billing-key-12345", customerId: "someone-else", price: 1 }) });
    expect(forged.status).toBe(400);
    expect(checkout).not.toHaveBeenCalled();
    const refused = await fetch(`${base}/api/guai-billing/checkout`, { method: "POST", headers: { "content-type": "application/json", "x-user": "local-owner" }, body: JSON.stringify({ skuId: "guai-ai-pro-monthly", idempotencyKey: "local-billing-key-12345" }) });
    expect(refused.status).toBe(503);
    expect(await refused.json()).toEqual({ error: "本地支付渠道尚未验证，暂不能创建订单" });
    expect(checkout).toHaveBeenCalledWith("local-owner", "guai-ai-pro-monthly", "local-billing-key-12345");
  });

  it("connects only the host's fixed module directory and never returns its runtime token", async () => {
    const { base, connectLocal } = await serve();
    const config = await fetch(`${base}/api/guai-billing/config`);
    expect(await config.json()).toEqual({ localModulePath: "/fixed/payment/module", localModuleError: "", localModuleConnected: true });
    const arbitraryPath = await fetch(`${base}/api/guai-billing/local/connect`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ modulePath: "/tmp/other" }) });
    expect(arbitraryPath.status).toBe(400);
    expect(connectLocal).not.toHaveBeenCalled();
    const connect = await fetch(`${base}/api/guai-billing/local/connect`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(await connect.json()).toEqual({ connected: true });
    expect(connectLocal).toHaveBeenCalledOnce();
  });
});
