import type { GuaiBillingLocalModule } from "./guai-billing-local-module.ts";
import type { GuaiWechatOrderRecord } from "./guai-wechat-orders.ts";
import { verifiedMembershipPeriod, type GuaiWechatEntitlementReadback, type GuaiWechatSqliteEntitlementStore } from "./guai-wechat-entitlements.ts";

const TRANSACTION_ID_RE = /^\d{1,32}$/;

export function createGuaiWechatFulfillment(deps: {
  localModule: Pick<GuaiBillingLocalModule, "state" | "grantVerifiedPayment">;
  entitlements: GuaiWechatSqliteEntitlementStore;
  now?: () => number;
}) {
  return {
    ready: () => deps.localModule.state === "ready",

    async onVerifiedPaid(order: GuaiWechatOrderRecord, signal: AbortSignal): Promise<void> {
      if (order.status !== "paid" || !order.customerId || !Number.isSafeInteger(order.includedCredits) || order.includedCredits <= 0 ||
        !order.transactionId || !TRANSACTION_ID_RE.test(order.transactionId) || !order.successTime || !Number.isFinite(Date.parse(order.successTime))) {
        throw new Error("Verified payment record is incomplete");
      }
      const period = order.kind === "subscription" ? verifiedMembershipPeriod(order) : null;
      await deps.localModule.grantVerifiedPayment({
        customerId: order.customerId,
        credits: order.includedCredits,
        transactionId: order.transactionId,
        kind: order.kind,
        ...(period ? { expiresAt: period.endsAt } : {}),
      }, signal);
      if (period) await deps.entitlements.grantFromVerifiedPayment(order);
    },

    readEntitlement(customerId: string, now = deps.now?.() ?? Date.now()): Promise<GuaiWechatEntitlementReadback> {
      return deps.entitlements.readEntitlement(customerId, now);
    },
  };
}
