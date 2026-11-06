import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { GuaiBillingSqliteStore } from "./guai-billing-store.ts";
import type { GuaiBillingOrderRecord } from "./guai-billing.ts";

const dirs: string[] = [];
const stores: GuaiBillingSqliteStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "guai-billing-store-"));
  dirs.push(dir);
  const path = join(dir, "orders.db");
  const store = new GuaiBillingSqliteStore(path);
  stores.push(store);
  return { path, store };
}

const order: GuaiBillingOrderRecord = {
  customerId: "customer-1", idempotencyKey: "key-1234567890123456", requestHash: "customer-1\npro",
  orderId: "pending-local", skuId: "pro", status: "pending",
};

describe("GuaiBillingSqliteStore", () => {
  it("atomically reserves idempotency and keeps order lookup scoped to its customer", async () => {
    const { store } = fixture();
    expect(await store.createIfAbsent(order)).toBe("created");
    expect(await store.createIfAbsent({ ...order, requestHash: "changed", skuId: "other" })).toBe("exists");
    expect(await store.getByIdempotencyKey("customer-1", order.idempotencyKey)).toMatchObject(order);
    expect(await store.get("customer-2", order.orderId)).toBeNull();
    await store.update({ ...order, orderId: "gateway-1", status: "pending" });
    expect(await store.get("customer-1", "pending-local")).toBeNull();
    expect(await store.get("customer-1", "gateway-1")).toMatchObject({ orderId: "gateway-1", skuId: "pro" });
  });

  it("persists order records across store instances", async () => {
    const { path, store } = fixture();
    await store.createIfAbsent(order);
    store.close();
    stores.splice(stores.indexOf(store), 1);
    const reopened = new GuaiBillingSqliteStore(path);
    stores.push(reopened);
    expect(await reopened.getByIdempotencyKey("customer-1", order.idempotencyKey)).toMatchObject(order);
  });
});
