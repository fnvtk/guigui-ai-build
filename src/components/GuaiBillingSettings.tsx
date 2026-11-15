import { useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { api } from "@/state/store";
import { Card } from "./SettingsPrimitives";
import type { GuaiBillingCatalog, GuaiBillingMembership, GuaiBillingPlan, GuaiCheckoutOrder } from "../../shared/guai-billing";

const REFERENCE_PLANS: Array<GuaiBillingPlan & { monthlyCredits: string }> = [
  { skuId: "reference-standard-monthly", name: "普通版", displayPrice: "¥19.8/月", availability: "reference_only", monthlyCredits: "2,000积分/月" },
  { skuId: "reference-professional-monthly", name: "专业版", displayPrice: "¥198/月", availability: "reference_only", monthlyCredits: "8,000积分/月" },
  { skuId: "reference-super-monthly", name: "超级版", displayPrice: "¥1,980/月", availability: "reference_only", monthlyCredits: "50,000积分/月" },
];

type CheckoutTarget = { kind: "https" | "wechat-native"; href: string };

function checkoutTarget(raw?: string): CheckoutTarget | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol === "https:" && !url.username && !url.password) return { kind: "https", href: url.href };
    const params = [...url.searchParams.entries()];
    if (url.protocol === "weixin:" && url.hostname === "wxpay" && url.pathname === "/bizpayurl" && !url.username && !url.password && !url.port && !url.hash &&
      params.length === 1 && params[0]?.[0] === "pr" && params[0][1].trim()) return { kind: "wechat-native", href: url.href };
    return null;
  } catch { return null; }
}

function orderStatus(order: GuaiCheckoutOrder, verified: boolean): string {
  if (!verified) return "正在等待服务端查单";
  if (order.status === "paid") return order.fulfillmentStatus === "fulfilled"
    ? "已付款，会员入账已完成；会员状态以权益读取为准"
    : "已付款，会员入账待完成";
  return ({ created: "已创建", pending: "处理中", failed: "支付失败", expired: "订单已过期", unknown: "状态未知" } as const)[order.status];
}

export function GuaiBillingSettings() {
  const [catalog, setCatalog] = useState<GuaiBillingCatalog | null>(null);
  const [membershipReadback, setMembershipReadback] = useState<{ status: "checking" | "verified" | "unavailable"; value?: GuaiBillingMembership }>({ status: "checking" });
  const [order, setOrder] = useState<GuaiCheckoutOrder | null>(null);
  const [orderVerified, setOrderVerified] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const pendingKeys = useRef(new Map<string, string>());

  const refreshMembership = async () => {
    setMembershipReadback({ status: "checking" });
    try {
      const value = await api<GuaiBillingMembership>("/api/guai-billing/membership");
      if (typeof value.active !== "boolean" || (value.activeUntil !== null && typeof value.activeUntil !== "string") || !Array.isArray(value.memberships)) throw new Error("会员状态格式无效");
      setMembershipReadback({ status: "verified", value });
    } catch {
      setMembershipReadback({ status: "unavailable" });
    }
  };

  const reload = async () => {
    setError(null);
    const [catalogResult] = await Promise.allSettled([
      api<GuaiBillingCatalog>("/api/guai-billing/catalog"),
      refreshMembership(),
    ]);
    if (catalogResult.status === "fulfilled") setCatalog(catalogResult.value);
    else setError(messageOf(catalogResult.reason, "读取会员套餐失败"));
    setLoading(false);
  };

  useEffect(() => { void reload(); }, []);

  const readOrder = async (orderId: string, original?: GuaiCheckoutOrder) => {
    setBusy("order"); setError(null);
    try {
      const latest = await api<GuaiCheckoutOrder>(`/api/guai-billing/checkout/${encodeURIComponent(orderId)}`);
      setOrder({ ...latest, checkoutUrl: checkoutTarget(latest.checkoutUrl)?.href ?? checkoutTarget(original?.checkoutUrl)?.href });
      setOrderVerified(true);
      if (latest.status === "paid") await refreshMembership();
    } catch (cause) {
      if (original) { setOrder(original); setOrderVerified(false); }
      setError(`${messageOf(cause, "订单状态读取失败")}；当前未确认支付状态。`);
    } finally { setBusy(null); }
  };

  const checkout = async (plan: GuaiBillingPlan) => {
    if (!canCheckout(catalog, plan)) return;
    const idempotencyKey = pendingKeys.current.get(plan.skuId) ?? crypto.randomUUID();
    pendingKeys.current.set(plan.skuId, idempotencyKey);
    setBusy(plan.skuId); setError(null); setNotice(null);
    try {
      const created = await api<GuaiCheckoutOrder>("/api/guai-billing/checkout", {
        method: "POST",
        body: JSON.stringify({ skuId: plan.skuId, idempotencyKey }),
      });
      pendingKeys.current.delete(plan.skuId);
      const initial = { ...created, status: "unknown" as const, checkoutUrl: checkoutTarget(created.checkoutUrl)?.href };
      setOrder(initial); setOrderVerified(false);
      await readOrder(created.orderId, initial);
    } catch (cause) { setError(messageOf(cause, "创建订单失败；可以使用同一套餐重试。")); }
    finally { setBusy(null); }
  };

  const plans = catalog?.configured && catalog.catalogConnected
    ? catalog.plans.map((plan) => ({ ...plan, monthlyCredits: "" }))
    : REFERENCE_PLANS;
  const usingReferencePrices = !(catalog?.configured && catalog.catalogConnected);
  const canUseProvider = catalog?.checkoutReady === true;
  const orderPaymentTarget = checkoutTarget(order?.checkoutUrl);

  return (
    <Card title="乖乖Ai 会员与用量" subtitle="会员开通与积分到账，以实际支付核验及入账结果为准。">
      <div className="space-y-5" data-guai-billing>
        <section aria-label="本月套餐状态" className="rounded-lg border border-hairline/50 bg-inset p-3">
          <h3 className="text-[13px] font-medium text-ink">本月套餐状态</h3>
          <p className="mt-1 text-[12px] text-ink-secondary">积分余额由卡若AI支付服务回读。</p>
          <p role="status" className="mt-1 text-[12px] text-ink-secondary">{membershipReadback.status === "checking" ? "正在读取会员状态…" : membershipReadback.status === "unavailable" ? "会员状态暂不可用；尚未判断为未开通。" : membershipReadback.value!.active ? "会员状态：已开通" : "会员状态：未开通"}</p>
          {membershipReadback.status === "verified" && membershipReadback.value!.active && <p className="mt-1 text-[12px] text-ink-secondary">{membershipReadback.value!.activeUntil ? `有效期至 ${membershipEndDate(membershipReadback.value!.activeUntil)}` : "会员有效期未设置结束日期"}</p>}
          <p className="mt-1 text-[12px] text-ink-secondary">本月积分消耗与重置日尚未接入。</p>
          {order && <p className="mt-2 text-[12px] text-ink" role="status">最近订单 {order.orderId}：{orderStatus(order, orderVerified)}</p>}
          {order && <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className="ui-button" disabled={busy === "order"} onClick={() => void readOrder(order.orderId, order)}>{busy === "order" ? "查询中…" : "刷新订单状态"}</button>
            {orderPaymentTarget?.kind === "https" && <a className="ui-button ui-button-primary" href={orderPaymentTarget.href} target="_blank" rel="noopener noreferrer">前往安全支付</a>}
          </div>}
          {orderPaymentTarget?.kind === "wechat-native" && <div data-wechat-qr className="mt-3 inline-flex flex-col items-center gap-2 rounded-lg border border-hairline/50 bg-white p-3 text-center">
            <p className="text-[13px] font-medium text-ink">微信扫码支付</p>
            <QRCodeSVG value={orderPaymentTarget.href} size={192} level="M" includeMargin title="微信扫码支付二维码" />
          </div>}
        </section>

        <section aria-label="套餐选购" className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-[13px] font-medium text-ink">套餐选购</h3>
            <button type="button" className="ui-button" disabled={loading || busy !== null} onClick={() => void reload()}>刷新套餐</button>
          </div>
          {loading && <p role="status" className="text-[12px] text-ink-secondary">正在读取会员套餐…</p>}
          {!loading && plans.length === 0 && <p className="text-[12px] text-ink-secondary">支付服务暂未提供可展示的套餐。</p>}
          <div className="grid gap-2 sm:grid-cols-3">
            {plans.map((plan) => {
              const enabled = canCheckout(catalog, plan) && canUseProvider;
              return <article key={plan.skuId} className="rounded-lg border border-hairline/50 p-3">
                <h4 className="text-[14px] font-medium text-ink">{plan.name}</h4>
                {plan.displayPrice && <p className="mt-1 text-[18px] font-semibold text-ink">{plan.displayPrice}</p>}
                {"monthlyCredits" in plan && plan.monthlyCredits && <p className="mt-1 text-[12px] text-ink-secondary">{plan.monthlyCredits}</p>}
                {plan.description && <p className="mt-2 text-[12px] leading-relaxed text-ink-secondary">{plan.description}</p>}
                {!enabled && <p className="mt-2 text-[12px] leading-relaxed text-ink-secondary">{plan.availability === "reference_only" || !catalog?.configured ? "只读参考价；支付服务尚未配置，暂不可购买。" : !canUseProvider ? "卡若AI支付服务未就绪，暂不可购买。" : "支付目录或结账尚未就绪，暂不可购买。"}</p>}
                <button type="button" className="ui-button ui-button-primary mt-3 w-full" disabled={!enabled || busy !== null} onClick={() => void checkout(plan)}>{busy === plan.skuId ? "正在创建订单…" : enabled ? "选择套餐" : "暂不可购买"}</button>
              </article>;
            })}
          </div>
          {catalog?.message && <p className="text-[12px] text-ink-secondary">{catalog.message}</p>}
          {(usingReferencePrices || catalog?.catalogStatus === "reference_only") && <p className="text-[11px] leading-relaxed text-ink-tertiary">参考价来源：<a href="https://kr-ai.quwanzhi.com/console/membership" target="_blank" rel="noopener noreferrer" className="underline">卡若AI会员页</a>。此处价格仅供参考，不能用于下单。</p>}
        </section>



        {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
        {notice && <p role="status" className="text-[12px] text-ink-secondary">{notice}</p>}
      </div>
    </Card>
  );
}

function canCheckout(catalog: GuaiBillingCatalog | null, plan: GuaiBillingPlan): boolean {
  return catalog?.configured === true && catalog.catalogConnected === true && catalog.checkoutReady === true &&
    plan.availability !== "reference_only" && plan.checkoutEnabled !== false;
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function membershipEndDate(raw: string): string {
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? "到期日期暂不可显示" : new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric" }).format(date);
}
