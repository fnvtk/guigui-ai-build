import { DatabaseSync } from "node:sqlite";
import { chmodSync, closeSync, mkdirSync, openSync } from "node:fs";
import { dirname } from "node:path";

import type { GuaiBillingOrderRecord, GuaiBillingOrderStore } from "./guai-billing.ts";

function toRecord(value: Record<string, unknown> | undefined): GuaiBillingOrderRecord | null {
  if (!value) return null;
  return {
    customerId: String(value.customer_id),
    idempotencyKey: String(value.idempotency_key),
    requestHash: String(value.request_hash),
    orderId: String(value.order_id),
    skuId: String(value.sku_id),
    status: value.status as GuaiBillingOrderRecord["status"],
    ...(typeof value.checkout_url === "string" ? { checkoutUrl: value.checkout_url } : {}),
  };
}

/** Durable private order state. The caller chooses a path inside its own DATA_DIR. */
export class GuaiBillingSqliteStore implements GuaiBillingOrderStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    closeSync(openSync(path, "a", 0o600));
    chmodSync(path, 0o600);
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;");
    this.db.exec(`CREATE TABLE IF NOT EXISTS guai_billing_orders (
      customer_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      order_id TEXT NOT NULL,
      sku_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('created', 'pending', 'paid', 'failed', 'expired', 'unknown')),
      checkout_url TEXT,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (customer_id, idempotency_key),
      UNIQUE (customer_id, order_id)
    );`);
  }

  async get(customerId: string, orderId: string): Promise<GuaiBillingOrderRecord | null> {
    return toRecord(this.db.prepare("SELECT * FROM guai_billing_orders WHERE customer_id = ? AND order_id = ?").get(customerId, orderId));
  }

  async getByIdempotencyKey(customerId: string, key: string): Promise<GuaiBillingOrderRecord | null> {
    return toRecord(this.db.prepare("SELECT * FROM guai_billing_orders WHERE customer_id = ? AND idempotency_key = ?").get(customerId, key));
  }

  async createIfAbsent(record: GuaiBillingOrderRecord): Promise<"created" | "exists"> {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.db.prepare("SELECT request_hash FROM guai_billing_orders WHERE customer_id = ? AND idempotency_key = ?").get(record.customerId, record.idempotencyKey);
      if (existing) {
        this.db.exec("COMMIT");
        return "exists";
      }
      this.db.prepare(`INSERT INTO guai_billing_orders
        (customer_id, idempotency_key, request_hash, order_id, sku_id, status, checkout_url, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(record.customerId, record.idempotencyKey, record.requestHash, record.orderId, record.skuId, record.status, record.checkoutUrl ?? null, Date.now());
      this.db.exec("COMMIT");
      return "created";
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  async update(record: GuaiBillingOrderRecord): Promise<void> {
    const result = this.db.prepare(`UPDATE guai_billing_orders SET order_id = ?, sku_id = ?, status = ?, checkout_url = ?, updated_at = ?
      WHERE customer_id = ? AND idempotency_key = ? AND request_hash = ?`)
      .run(record.orderId, record.skuId, record.status, record.checkoutUrl ?? null, Date.now(), record.customerId, record.idempotencyKey, record.requestHash);
    if (result.changes !== 1) throw new Error("Guai billing order update did not match its idempotency reservation");
  }

  close(): void { this.db.close(); }
}
