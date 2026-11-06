import { DatabaseSync } from "node:sqlite";
import { chmodSync, closeSync, mkdirSync, openSync } from "node:fs";
import { dirname } from "node:path";

import type { GuaiCheckoutStatus } from "../shared/guai-billing.ts";

export interface GuaiWechatOrderRecord {
  customerId: string;
  idempotencyKey: string;
  skuId: string;
  description: string;
  kind: string;
  includedCredits: number;
  durationMonths?: number;
  priceVersionId: string;
  amountMinor: number;
  currency: "CNY";
  outTradeNo: string;
  merchantId: string;
  appId: string;
  orderId: string;
  status: GuaiCheckoutStatus;
  transactionId?: string;
  successTime?: string;
  fulfilledAt?: string;
  checkoutUrl?: string;
}

export interface GuaiWechatOrderStore {
  get(customerId: string, orderId: string): Promise<GuaiWechatOrderRecord | null>;
  getByIdempotencyKey(customerId: string, key: string): Promise<GuaiWechatOrderRecord | null>;
  createIfAbsent(record: GuaiWechatOrderRecord): Promise<GuaiWechatOrderRecord>;
  update(record: GuaiWechatOrderRecord): Promise<void>;
  markFulfilled(record: GuaiWechatOrderRecord, fulfilledAt: string): Promise<GuaiWechatOrderRecord>;
}

export class GuaiWechatTransactionConflictError extends Error {
  constructor() { super("WeChat transaction ID is already assigned to another order"); }
}

function toRecord(value: Record<string, unknown> | undefined): GuaiWechatOrderRecord | null {
  if (!value) return null;
  return {
    customerId: String(value.customer_id),
    idempotencyKey: String(value.idempotency_key),
    skuId: String(value.sku_id),
    description: String(value.description),
    kind: String(value.kind ?? "unknown"),
    includedCredits: Number(value.included_credits ?? 0),
    ...(typeof value.duration_months === "number" ? { durationMonths: value.duration_months } : {}),
    priceVersionId: String(value.price_version_id),
    amountMinor: Number(value.amount_minor),
    currency: "CNY",
    outTradeNo: String(value.out_trade_no),
    merchantId: String(value.merchant_id),
    appId: String(value.app_id),
    orderId: String(value.order_id),
    status: value.status as GuaiCheckoutStatus,
    ...(typeof value.transaction_id === "string" ? { transactionId: value.transaction_id } : {}),
    ...(typeof value.success_time === "string" ? { successTime: value.success_time } : {}),
    ...(typeof value.fulfilled_at === "string" ? { fulfilledAt: value.fulfilled_at } : {}),
    ...(typeof value.checkout_url === "string" ? { checkoutUrl: value.checkout_url } : {}),
  };
}

/** Durable provider order state, kept separate from the generic billing request hash. */
export class GuaiWechatSqliteOrderStore implements GuaiWechatOrderStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    closeSync(openSync(path, "a", 0o600));
    chmodSync(path, 0o600);
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;");
    this.db.exec(`CREATE TABLE IF NOT EXISTS guai_wechat_orders (
      customer_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      sku_id TEXT NOT NULL,
      description TEXT NOT NULL,
      kind TEXT NOT NULL,
      included_credits INTEGER NOT NULL CHECK (included_credits >= 0),
      duration_months INTEGER,
      price_version_id TEXT NOT NULL,
      amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
      currency TEXT NOT NULL CHECK (currency = 'CNY'),
      out_trade_no TEXT NOT NULL UNIQUE,
      merchant_id TEXT NOT NULL,
      app_id TEXT NOT NULL,
      transaction_id TEXT,
      success_time TEXT,
      fulfilled_at TEXT,
      order_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('created', 'pending', 'paid', 'failed', 'expired', 'unknown')),
      checkout_url TEXT,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (customer_id, idempotency_key),
      UNIQUE (customer_id, order_id),
      UNIQUE (merchant_id, transaction_id),
      CHECK (status != 'paid' OR transaction_id IS NOT NULL)
    );`);
    const columns = new Set((this.db.prepare("PRAGMA table_info(guai_wechat_orders)").all() as Array<{ name: string }>).map(({ name }) => name));
    for (const [name, definition] of [
      ["kind", "TEXT NOT NULL DEFAULT 'unknown'"],
      ["included_credits", "INTEGER NOT NULL DEFAULT 0"],
      ["duration_months", "INTEGER"],
      ["transaction_id", "TEXT"],
      ["success_time", "TEXT"],
      ["fulfilled_at", "TEXT"],
    ]) {
      if (!columns.has(name)) this.db.exec(`ALTER TABLE guai_wechat_orders ADD COLUMN ${name} ${definition}`);
    }
    this.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS guai_wechat_merchant_transaction ON guai_wechat_orders(merchant_id, transaction_id)");
  }

  async get(customerId: string, orderId: string): Promise<GuaiWechatOrderRecord | null> {
    return toRecord(this.db.prepare("SELECT * FROM guai_wechat_orders WHERE customer_id = ? AND order_id = ?").get(customerId, orderId));
  }

  async getByIdempotencyKey(customerId: string, key: string): Promise<GuaiWechatOrderRecord | null> {
    return toRecord(this.db.prepare("SELECT * FROM guai_wechat_orders WHERE customer_id = ? AND idempotency_key = ?").get(customerId, key));
  }

  async createIfAbsent(record: GuaiWechatOrderRecord): Promise<GuaiWechatOrderRecord> {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.db.prepare("SELECT * FROM guai_wechat_orders WHERE customer_id = ? AND idempotency_key = ?").get(record.customerId, record.idempotencyKey);
      if (existing) {
        this.db.exec("COMMIT");
        return toRecord(existing)!;
      }
      this.db.prepare(`INSERT INTO guai_wechat_orders
        (customer_id, idempotency_key, sku_id, description, kind, included_credits, duration_months, price_version_id, amount_minor, currency, out_trade_no, merchant_id, app_id, transaction_id, success_time, fulfilled_at, order_id, status, checkout_url, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(record.customerId, record.idempotencyKey, record.skuId, record.description, record.kind, record.includedCredits, record.durationMonths ?? null,
          record.priceVersionId, record.amountMinor, record.currency,
          record.outTradeNo, record.merchantId, record.appId, record.transactionId ?? null, record.successTime ?? null, record.fulfilledAt ?? null,
          record.orderId, record.status, record.checkoutUrl ?? null, Date.now());
      this.db.exec("COMMIT");
      return record;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  async update(record: GuaiWechatOrderRecord): Promise<void> {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.db.prepare("SELECT transaction_id, success_time FROM guai_wechat_orders WHERE customer_id = ? AND idempotency_key = ? AND sku_id = ? AND price_version_id = ? AND amount_minor = ? AND out_trade_no = ?")
        .get(record.customerId, record.idempotencyKey, record.skuId, record.priceVersionId, record.amountMinor, record.outTradeNo);
      if (!existing) throw new Error("WeChat order update did not match its immutable price snapshot");
      const existingTransactionId = typeof existing.transaction_id === "string" ? existing.transaction_id : undefined;
      if (existingTransactionId && existingTransactionId !== record.transactionId) throw new GuaiWechatTransactionConflictError();
      if (typeof existing.success_time === "string" && existing.success_time !== record.successTime) throw new Error("WeChat order success time is immutable");
      if (record.transactionId) {
        const assigned = this.db.prepare("SELECT customer_id, idempotency_key FROM guai_wechat_orders WHERE merchant_id = ? AND transaction_id = ?")
          .get(record.merchantId, record.transactionId);
        if (assigned && (assigned.customer_id !== record.customerId || assigned.idempotency_key !== record.idempotencyKey)) {
          throw new GuaiWechatTransactionConflictError();
        }
      }
      const result = this.db.prepare(`UPDATE guai_wechat_orders SET status = ?, transaction_id = ?, success_time = ?, checkout_url = ?, updated_at = ?
        WHERE customer_id = ? AND idempotency_key = ? AND sku_id = ? AND price_version_id = ? AND amount_minor = ? AND out_trade_no = ?`)
        .run(record.status, record.transactionId ?? null, record.successTime ?? null, record.checkoutUrl ?? null, Date.now(), record.customerId, record.idempotencyKey,
          record.skuId, record.priceVersionId, record.amountMinor, record.outTradeNo);
      if (result.changes !== 1) throw new Error("WeChat order update did not match its immutable price snapshot");
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  async markFulfilled(record: GuaiWechatOrderRecord, fulfilledAt: string): Promise<GuaiWechatOrderRecord> {
    if (record.status !== "paid" || !record.transactionId || !record.successTime || !record.includedCredits) {
      throw new Error("Only a verified WeChat payment can be fulfilled");
    }
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = this.db.prepare(`UPDATE guai_wechat_orders SET fulfilled_at = COALESCE(fulfilled_at, ?), updated_at = ?
        WHERE customer_id = ? AND idempotency_key = ? AND status = 'paid' AND transaction_id = ? AND success_time = ?`)
        .run(fulfilledAt, Date.now(), record.customerId, record.idempotencyKey, record.transactionId, record.successTime);
      if (result.changes !== 1) throw new Error("WeChat fulfillment did not match its verified paid order");
      const stored = this.db.prepare("SELECT fulfilled_at FROM guai_wechat_orders WHERE customer_id = ? AND idempotency_key = ?")
        .get(record.customerId, record.idempotencyKey);
      this.db.exec("COMMIT");
      return { ...record, fulfilledAt: String(stored?.fulfilled_at) };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  close(): void { this.db.close(); }
}
