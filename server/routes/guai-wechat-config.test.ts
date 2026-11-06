import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { json, readBody } from "../harness/http.ts";
import { createGuaiWechatConfigRoutes } from "./guai-wechat-config.ts";
import { dispatchRoutes } from "./table.ts";
import type { WechatNativeConfig } from "../guai-billing-wechat.ts";

const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve())))); });
async function fixture() {
  let config: WechatNativeConfig = { enabled: false, apiV3Key: "private-test-value-never-public" };
  const save = vi.fn((patch: object) => { config = { ...config, ...patch }; });
  const importCredentials = vi.fn(async () => {});
  const routes = [createGuaiWechatConfigRoutes({ config: () => config, save, importCredentials,
    readiness: async current => ({ ready: !!current.appId && !!current.merchantId, missingFields: current.appId ? ["wechatMerchantId"] : ["wechatAppId", "wechatMerchantId"] }),
  })];
  const server = createServer((req, res) => {
    const url = new URL(req.url!, "http://localhost");
    void dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth: { kind: "loopback", scopes: ["admin", "client"] }, json, readBody });
  });
  servers.push(server); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/guai-billing/wechat`;
  const request = (path: string, method = "GET", body?: unknown) => fetch(base + path, { method, ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
  return { request, save, importCredentials };
}

describe("owner local WeChat configuration", () => {
  it("returns write-only credential presence and readable missing fields", async () => {
    const { request } = await fixture();
    const body = await (await request("/config")).json();
    expect(body).toMatchObject({ enabled: false, ready: false, apiV3KeyConfigured: true, missingFields: ["appId", "merchantId"] });
    expect(JSON.stringify(body)).not.toContain("private-test-value-never-public");
  });
  it("rejects keys and cannot enable an incomplete merchant", async () => {
    const { request, save } = await fixture();
    expect((await request("/config", "PUT", { apiV3Key: "must-use-safe-storage" })).status).toBe(400);
    expect((await request("/config", "PUT", { enabled: true })).status).toBe(422);
    expect(save).not.toHaveBeenCalled();
  });
  it("saves only public fields and reads them back without a live payment request", async () => {
    const { request, save } = await fixture();
    const response = await request("/config", "PUT", { enabled: false, appId: "wx-example" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ appId: "wx-example", enabled: false, apiV3KeyConfigured: true });
    expect(save).toHaveBeenCalledExactlyOnceWith({ appId: "wx-example", enabled: false });
  });
  it("imports only the fixed host directory, never a client supplied path", async () => {
    const { request, importCredentials } = await fixture();
    expect((await request("/import", "POST", { path: "/outside" })).status).toBe(400);
    expect(importCredentials).not.toHaveBeenCalled();
    expect((await request("/import", "POST", {})).status).toBe(200);
    expect(importCredentials).toHaveBeenCalledExactlyOnceWith();
  });
});
