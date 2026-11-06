import { DatabaseSync } from "node:sqlite";
import { chmodSync, closeSync, mkdirSync, openSync } from "node:fs";
import { dirname } from "node:path";

import type { GuaiWechatOrderRecord } from "./guai-wechat-orders.ts";

const TRANSACTION_ID_RE = /^\d{1,32}$/;

export interface GuaiWechatEntitlement {
  customerId: string;
  orderId: string;
  transactionId: string;
  merchantId: string;
  skuId: string;
  priceVersionId: string;
  includedCredits: number;
  durationMonths: number;
  startsAt: string;
  endsAt: string;
}

export interface GuaiWechatEntitlementReadback {
  active: boolean;
  activeUntil: string | null;
  memberships: GuaiWechatEntitlement[];
}

function addMonths(start: string, durationMonths: number): string {
  const source = new Date(start);
  const totalMonths = source.getUTCFullYear() * 12 + source.getUTCMonth() + durationMonths;
  const year = Math.floor(totalMonths / 12);
  const month = totalMonths % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(source.getUTCDate(), lastDay), source.getUTCHours(), source.getUTCMinutes(), source.getUTCSeconds(), source.getUTCMilliseconds())).toISOString();
}

function toRecord(value: Record<string, unknown>): GuaiWechatEntitlement {
  return {
    customerId: String(value.customer_id),
    orderId: String(value.order_id),
    transactionId: String(value.transaction_id),
    merchantId: String(value.merchant_id),
    skuId: String(value.sku_id),
    priceVersionId: String(value.price_version_id),
    includedCredits: Number(value.included_credits),
    durationMonths: Number(value.duration_months),
    startsAt: String(value.starts_at),
    endsAt: String(value.ends_at),
  };
}

export function verifiedMembershipPeriod(order: GuaiWechatOrderRecord): GuaiWechatEntitlement {
  if (order.status !== "paid" || order.kind !== "subscription" || !Number.isSafeInteger(order.includedCredits) || order.includedCredits <= 0 ||
    !Number.isSafeInteger(order.durationMonths) || !order.durationMonths || !order.transactionId || !TRANSACTION_ID_RE.test(order.transactionId) ||
    !order.successTime || !Number.isFinite(Date.parse(order.successTime))) {
    throw new Error("Verified subscription record is incomplete");
  }
  return {
    customerId: order.customerId,
    orderId: order.orderId,
    transactionId: order.transactionId,
    merchantId: order.merchantId,
    skuId: order.skuId,
    priceVersionId: order.priceVersionId,
    includedCredits: order.includedCredits,
    durationMonths: order.durationMonths,
    startsAt: new Date(Date.parse(order.successTime)).toISOString(),
    endsAt: addMonths(order.successTime, order.durationMonths),
  };
}

/** Durable host-owned membership periods. A payment record's provider success time is the period start. */
export class GuaiWechatSqliteEntitlementStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    closeSync(openSync(path, "a", 0o600));
    chmodSync(path, 0o600);
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;");
    this.db.exec(`CREATE TABLE IF NOT EXISTS guai_wechat_entitlements (
      customer_id TEXT NOT NULL,
      order_id TEXT NOT NULL,
      transaction_id TEXT NOT NULL,
      merchant_id TEXT NOT NULL,
      sku_id TEXT NOT NULL,
      price_version_id TEXT NOT NULL,
      included_credits INTEGER NOT NULL CHECK (included_credits > 0),
      duration_months INTEGER NOT NULL CHECK (duration_months > 0),
      starts_at TEXT NOT NULL,
      ends_at TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (customer_id, order_id),
      UNIQUE (merchant_id, transaction_id)
    );`);
  }

  async grantFromVerifiedPayment(order: GuaiWechatOrderRecord): Promise<GuaiWechatEntitlement> {
    const candidate = verifiedMembershipPeriod(order);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.db.prepare("SELECT * FROM guai_wechat_entitlements WHERE customer_id = ? AND order_id = ?").get(order.customerId, order.orderId);
      if (existing) {
        const previous = toRecord(existing);
        if (JSON.stringify(previous) !== JSON.stringify(candidate)) throw new Error("Verified payment conflicts with its existing membership period");
        this.db.exec("COMMIT");
        return previous;
      }
      this.db.prepare(`INSERT INTO guai_wechat_entitlements
        (customer_id, order_id, transaction_id, merchant_id, sku_id, price_version_id, included_credits, duration_months, starts_at, ends_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(candidate.customerId, candidate.orderId, candidate.transactionId, candidate.merchantId, candidate.skuId, candidate.priceVersionId,
          candidate.includedCredits, candidate.durationMonths, candidate.startsAt, candidate.endsAt, Date.now());
      this.db.exec("COMMIT");
      return candidate;
    } catch (error) {
      this.db.exec("ROLLBACK");
      if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) throw new Error("WeChat transaction is already assigned to a membership period");
      throw error;
    }
  }

  async readEntitlement(customerId: string, now = Date.now()): Promise<GuaiWechatEntitlementReadback> {
    const rows = this.db.prepare("SELECT * FROM guai_wechat_entitlements WHERE customer_id = ? ORDER BY starts_at DESC, order_id DESC").all(customerId) as Array<Record<string, unknown>>;
    const memberships = rows.map(toRecord);
    const active = memberships.filter((item) => Date.parse(item.startsAt) <= now && now < Date.parse(item.endsAt));
    const activeUntil = active.reduce<string | null>((latest, item) => latest === null || item.endsAt > latest ? item.endsAt : latest, null);
    return { active: active.length > 0, activeUntil, memberships };
  }

  close(): void { this.db.close(); }
}
