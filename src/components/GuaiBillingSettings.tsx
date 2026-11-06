import { useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { api } from "@/state/store";
import { Card } from "./SettingsPrimitives";
import type { GuaiBillingCatalog, GuaiBillingPlan, GuaiCheckoutOrder, GuaiBillingBalance } from "../../shared/guai-billing";

interface GuaiBillingPublicConfig {
  localModulePath?: string;
  localModuleConnected?: boolean;
  localModuleError?: string;
}

interface GuaiBillingWechatConfig {
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
}

interface GuaiBillingMembership {
  active: boolean;
  activeUntil: string | null;
  memberships: Array<{ skuId: string; startsAt: string; endsAt: string | null }>;
}

type GuaiBillingWechatDraft = Pick<GuaiBillingWechatConfig,
  "enabled" | "appId" | "merchantId" | "merchantCertificatePath" | "privateKeyPath" | "platformCertificatePath" | "platformSerialNo" | "notifyUrl">;

const EMPTY_WECHAT_DRAFT: GuaiBillingWechatDraft = {
  enabled: false, appId: "", merchantId: "", merchantCertificatePath: "", privateKeyPath: "", platformCertificatePath: "", platformSerialNo: "", notifyUrl: "",
};
const WECHAT_IMPORT_DIRECTORY = "/Users/karuo/Documents/开发/4、模块/支付模块/支付/微信";

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
  const [publicConfig, setPublicConfig] = useState<GuaiBillingPublicConfig | null>(null);
  const [wechatConfig, setWechatConfig] = useState<GuaiBillingWechatConfig | null>(null);
  const [wechatDraft, setWechatDraft] = useState<GuaiBillingWechatDraft>(EMPTY_WECHAT_DRAFT);
  const [wechatKeyDraft, setWechatKeyDraft] = useState("");
  const [wechatError, setWechatError] = useState<string | null>(null);
  const [wechatNotice, setWechatNotice] = useState<string | null>(null);
  const [balance, setBalance] = useState<GuaiBillingBalance | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);
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
    const [configResult, catalogResult, wechatResult] = await Promise.allSettled([
      api<GuaiBillingPublicConfig>("/api/guai-billing/config"),
      api<GuaiBillingCatalog>("/api/guai-billing/catalog"),
      api<GuaiBillingWechatConfig>("/api/guai-billing/wechat/config"),
      refreshMembership(),
    ]);
    if (configResult.status === "fulfilled") {
      setPublicConfig(configResult.value);
      if (configResult.value.localModuleConnected) {
        try { setBalance(await api<GuaiBillingBalance>("/api/guai-billing/balance")); setBalanceError(null); }
        catch (cause) { setBalance(null); setBalanceError(messageOf(cause, "读取本机余额失败")); }
      } else { setBalance(null); setBalanceError(null); }
    } else setError(messageOf(configResult.reason, "读取支付配置失败"));
    if (catalogResult.status === "fulfilled") setCatalog(catalogResult.value);
    else setError(messageOf(catalogResult.reason, "读取会员套餐失败"));
    if (wechatResult.status === "fulfilled") {
      setWechatConfig(wechatResult.value);
      setWechatDraft({
        enabled: wechatResult.value.enabled,
        appId: wechatResult.value.appId,
        merchantId: wechatResult.value.merchantId,
        merchantCertificatePath: wechatResult.value.merchantCertificatePath,
        privateKeyPath: wechatResult.value.privateKeyPath,
        platformCertificatePath: wechatResult.value.platformCertificatePath,
        platformSerialNo: wechatResult.value.platformSerialNo,
        notifyUrl: wechatResult.value.notifyUrl,
      });
      setWechatError(null);
    } else {
      setWechatConfig(null);
      setWechatError(messageOf(wechatResult.reason, "读取微信收款配置失败"));
    }
    setLoading(false);
  };

  useEffect(() => { void reload(); }, []);

  const connectLocal = async () => {
    setBusy("local"); setError(null); setNotice(null);
    try {
      if (!publicConfig?.localModuleConnected) {
        const pickFolder = window.ogb?.pickFolder;
        if (!pickFolder || !publicConfig?.localModulePath) throw new Error("请在桌面应用中选择本机支付模块文件夹。");
        const selected = await pickFolder(publicConfig.localModulePath);
        if (selected === null) return;
        if (selected !== publicConfig.localModulePath) throw new Error("请选择页面列出的本机支付模块文件夹，未连接其他目录。");
      }
      await api("/api/guai-billing/local/connect", { method: "POST", body: "{}" });
      await reload();
      setNotice("本机支付模块已连接，收款是否可用以真实渠道状态为准。");
    } catch (cause) { setError(messageOf(cause, "连接本机支付模块失败")); }
    finally { setBusy(null); }
  };

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

  const saveWechatConfig = async () => {
    setBusy("wechat-config"); setWechatError(null); setWechatNotice(null);
    try {
      const next = await api<GuaiBillingWechatConfig>("/api/guai-billing/wechat/config", {
        method: "PUT",
        body: JSON.stringify(wechatDraft),
      });
      setWechatConfig(next);
      setWechatDraft({
        enabled: next.enabled,
        appId: next.appId,
        merchantId: next.merchantId,
        merchantCertificatePath: next.merchantCertificatePath,
        privateKeyPath: next.privateKeyPath,
        platformCertificatePath: next.platformCertificatePath,
        platformSerialNo: next.platformSerialNo,
        notifyUrl: next.notifyUrl,
      });
      setWechatNotice(next.ready ? "微信商户配置已回读。支付仍以本机模块和订单状态接口为准。" : "配置已保存；商户信息不完整，不能下单或确认会员状态。");
    } catch (cause) { setWechatError(messageOf(cause, "保存微信收款配置失败")); }
    finally { setBusy(null); }
  };

  const saveWechatApiV3Key = async (clear = false) => {
    const save = window.ogb?.setCredential;
    if (!save) return;
    setBusy("wechat-key"); setWechatError(null); setWechatNotice(null);
    try {
      await save("guaiBillingWechatApiV3Key", clear ? "" : wechatKeyDraft);
      setWechatKeyDraft("");
      const next = await api<GuaiBillingWechatConfig>("/api/guai-billing/wechat/config");
      setWechatConfig(next);
      setWechatDraft({
        enabled: next.enabled,
        appId: next.appId,
        merchantId: next.merchantId,
        merchantCertificatePath: next.merchantCertificatePath,
        privateKeyPath: next.privateKeyPath,
        platformCertificatePath: next.platformCertificatePath,
        platformSerialNo: next.platformSerialNo,
        notifyUrl: next.notifyUrl,
      });
      setWechatNotice(clear ? "APIv3密钥已从桌面安全存储中清除。" : "APIv3密钥已保存到桌面安全存储。");
    } catch (cause) { setWechatError(messageOf(cause, "保存APIv3密钥失败")); }
    finally { setBusy(null); }
  };

  const importWechatCertificates = async () => {
    const pickFolder = window.ogb?.pickFolder;
    if (!pickFolder) return;
    setBusy("wechat-import"); setWechatError(null); setWechatNotice(null);
    try {
      const selected = await pickFolder(WECHAT_IMPORT_DIRECTORY);
      if (selected === null) return;
      if (selected !== WECHAT_IMPORT_DIRECTORY) throw new Error("请选择指定的本机微信证书目录；未导入其他目录。");
      await api("/api/guai-billing/wechat/import", { method: "POST", body: "{}" });
      const next = await api<GuaiBillingWechatConfig>("/api/guai-billing/wechat/config");
      setWechatConfig(next);
      setWechatDraft({
        enabled: next.enabled,
        appId: next.appId,
        merchantId: next.merchantId,
        merchantCertificatePath: next.merchantCertificatePath,
        privateKeyPath: next.privateKeyPath,
        platformCertificatePath: next.platformCertificatePath,
        platformSerialNo: next.platformSerialNo,
        notifyUrl: next.notifyUrl,
      });
      setWechatNotice("微信证书已导入应用私有目录；原共享文件未修改。请核对证书配置并单独保存启用状态。");
    } catch (cause) { setWechatError(messageOf(cause, "导入本机微信证书失败")); }
    finally { setBusy(null); }
  };

  const checkout = async (plan: GuaiBillingPlan) => {
    if (!canCheckout(catalog, plan) || wechatConfig?.ready !== true || wechatConfig.enabled !== true) return;
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
  const canUseWechat = wechatConfig?.ready === true && wechatConfig.enabled === true;
  const orderPaymentTarget = checkoutTarget(order?.checkoutUrl);

  return (
    <Card title="乖乖Ai 会员与用量" subtitle="会员开通与积分到账，以实际支付核验及入账结果为准。">
      <div className="space-y-5" data-guai-billing>
        <section aria-label="本月套餐状态" className="rounded-lg border border-hairline/50 bg-inset p-3">
          <h3 className="text-[13px] font-medium text-ink">本月套餐状态</h3>
          {balance ? <p className="mt-1 text-[12px] text-ink-secondary">本机账本：可用积分 {balance.availableCredits}，预占积分 {balance.reservedCredits}。尚未接入实际模型消费结算。</p> : <p className="mt-1 text-[12px] text-ink-secondary">连接本机支付模块后可读取真实账本余额。</p>}
          <p role="status" className="mt-1 text-[12px] text-ink-secondary">{membershipReadback.status === "checking" ? "正在读取会员状态…" : membershipReadback.status === "unavailable" ? "会员状态暂不可用；尚未判断为未开通。" : membershipReadback.value!.active ? "会员状态：已开通" : "会员状态：未开通"}</p>
          {membershipReadback.status === "verified" && membershipReadback.value!.active && <p className="mt-1 text-[12px] text-ink-secondary">{membershipReadback.value!.activeUntil ? `有效期至 ${membershipEndDate(membershipReadback.value!.activeUntil)}` : "会员有效期未设置结束日期"}</p>}
          <p className="mt-1 text-[12px] text-ink-secondary">本月积分消耗与重置日尚未接入。</p>
          {balanceError && <p role="alert" className="mt-1 text-[12px] text-danger">{balanceError}</p>}
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
              const enabled = canCheckout(catalog, plan) && canUseWechat;
              return <article key={plan.skuId} className="rounded-lg border border-hairline/50 p-3">
                <h4 className="text-[14px] font-medium text-ink">{plan.name}</h4>
                {plan.displayPrice && <p className="mt-1 text-[18px] font-semibold text-ink">{plan.displayPrice}</p>}
                {"monthlyCredits" in plan && plan.monthlyCredits && <p className="mt-1 text-[12px] text-ink-secondary">{plan.monthlyCredits}</p>}
                {plan.description && <p className="mt-2 text-[12px] leading-relaxed text-ink-secondary">{plan.description}</p>}
                {!enabled && <p className="mt-2 text-[12px] leading-relaxed text-ink-secondary">{plan.availability === "reference_only" || !catalog?.configured ? "只读参考价；支付服务尚未配置，暂不可购买。" : !canUseWechat ? "微信商户配置未启用或未就绪，暂不可购买。" : "支付目录或结账尚未就绪，暂不可购买。"}</p>}
                <button type="button" className="ui-button ui-button-primary mt-3 w-full" disabled={!enabled || busy !== null} onClick={() => void checkout(plan)}>{busy === plan.skuId ? "正在创建订单…" : enabled ? "选择套餐" : "暂不可购买"}</button>
              </article>;
            })}
          </div>
          {catalog?.message && <p className="text-[12px] text-ink-secondary">{catalog.message}</p>}
          {(usingReferencePrices || catalog?.catalogStatus === "reference_only") && <p className="text-[11px] leading-relaxed text-ink-tertiary">参考价来源：<a href="https://kr-ai.quwanzhi.com/console/membership" target="_blank" rel="noopener noreferrer" className="underline">卡若AI会员页</a>。此处价格仅供参考，不能用于下单。</p>}
        </section>

        <section className="rounded-lg border border-hairline/50 px-3 py-3">
          <h3 className="text-[13px] font-medium text-ink">本机支付模块</h3>
          <p className="mt-1 text-[12px] text-ink-secondary">直接使用这台电脑上已有的支付模块，账本保存在本机。套餐目录和余额由模块实际回读。</p>
          {publicConfig?.localModulePath && <p className="mt-2 break-all text-[11px] text-ink-tertiary">{publicConfig.localModulePath}</p>}
          <button type="button" className="ui-button mt-3" disabled={busy !== null} onClick={() => void connectLocal()}>{busy === "local" ? "正在连接…" : publicConfig?.localModuleConnected ? "重新检查本机模块" : "连接本机支付模块"}</button>
          {publicConfig?.localModuleError && <p role="alert" className="mt-2 text-[12px] text-danger">{publicConfig.localModuleError}</p>}
        </section>

        <details className="rounded-lg border border-hairline/50 px-3 py-2.5" data-wechat-billing-config>
          <summary className="cursor-pointer text-[13px] font-medium text-ink">微信收款配置</summary>
          <div className="mt-3 space-y-3">
            <p className="text-[12px] leading-relaxed text-ink-secondary">配置保存在本机。缺少商户参数或APIv3密钥时不能下单，也不会显示支付成功或已开通会员。请先保存商户资料和密钥，再单独启用收款。</p>
            {loading && <p role="status" className="text-[12px] text-ink-secondary">正在读取微信收款配置…</p>}
            {wechatConfig && <p role="status" className="text-[12px] text-ink-secondary">{wechatConfig.ready ? "商户资料与密钥已齐全" : `配置尚未完整${wechatConfig.missingFields.length ? `：${wechatConfig.missingFields.map(wechatFieldName).join("、")}` : ""}`}；当前{wechatConfig.enabled ? "已启用" : "未启用"}。</p>}
            {wechatError && <p role="alert" className="text-[12px] text-danger">{wechatError}</p>}
            <button type="button" className="ui-button" disabled={busy !== null || !window.ogb?.pickFolder} onClick={() => void importWechatCertificates()}>{busy === "wechat-import" ? "正在安全导入证书…" : "导入本机微信证书"}</button>
            {!window.ogb?.pickFolder && <p className="text-[12px] text-ink-secondary">证书导入只能在桌面应用中进行；浏览器不会读取私钥文件。</p>}
            <label className="block text-[12px] text-ink-secondary">微信应用 AppID
              <input data-wechat-field="appId" className="mt-1 w-full rounded-md border border-hairline bg-app px-2.5 py-2 text-[13px] text-ink" value={wechatDraft.appId} onChange={(event) => setWechatDraft({ ...wechatDraft, appId: event.target.value })} autoComplete="off" />
            </label>
            <label className="block text-[12px] text-ink-secondary">微信支付商户号
              <input data-wechat-field="merchantId" className="mt-1 w-full rounded-md border border-hairline bg-app px-2.5 py-2 text-[13px] text-ink" value={wechatDraft.merchantId} onChange={(event) => setWechatDraft({ ...wechatDraft, merchantId: event.target.value })} autoComplete="off" />
            </label>
            <label className="block text-[12px] text-ink-secondary">商户证书文件路径
              <input data-wechat-field="merchantCertificatePath" className="mt-1 w-full rounded-md border border-hairline bg-app px-2.5 py-2 text-[13px] text-ink" value={wechatDraft.merchantCertificatePath} onChange={(event) => setWechatDraft({ ...wechatDraft, merchantCertificatePath: event.target.value })} autoComplete="off" />
            </label>
            <label className="block text-[12px] text-ink-secondary">商户私钥文件路径
              <input data-wechat-field="privateKeyPath" className="mt-1 w-full rounded-md border border-hairline bg-app px-2.5 py-2 text-[13px] text-ink" value={wechatDraft.privateKeyPath} onChange={(event) => setWechatDraft({ ...wechatDraft, privateKeyPath: event.target.value })} autoComplete="off" />
            </label>
            <label className="block text-[12px] text-ink-secondary">微信支付平台证书路径
              <input data-wechat-field="platformCertificatePath" className="mt-1 w-full rounded-md border border-hairline bg-app px-2.5 py-2 text-[13px] text-ink" value={wechatDraft.platformCertificatePath} onChange={(event) => setWechatDraft({ ...wechatDraft, platformCertificatePath: event.target.value })} autoComplete="off" />
            </label>
            <label className="block text-[12px] text-ink-secondary">微信支付平台证书序列号
              <input data-wechat-field="platformSerialNo" className="mt-1 w-full rounded-md border border-hairline bg-app px-2.5 py-2 text-[13px] text-ink" value={wechatDraft.platformSerialNo} onChange={(event) => setWechatDraft({ ...wechatDraft, platformSerialNo: event.target.value })} autoComplete="off" />
            </label>
            <label className="block text-[12px] text-ink-secondary">支付通知地址
              <input data-wechat-field="notifyUrl" className="mt-1 w-full rounded-md border border-hairline bg-app px-2.5 py-2 text-[13px] text-ink" type="url" value={wechatDraft.notifyUrl} onChange={(event) => setWechatDraft({ ...wechatDraft, notifyUrl: event.target.value })} autoComplete="url" />
            </label>
            <label className="block text-[12px] text-ink-secondary">APIv3密钥
              <input data-wechat-api-v3-key className="mt-1 w-full rounded-md border border-hairline bg-app px-2.5 py-2 text-[13px] text-ink disabled:opacity-50" type="password" value={wechatKeyDraft} onChange={(event) => setWechatKeyDraft(event.target.value)} autoComplete="new-password" disabled={!window.ogb?.setCredential} placeholder={wechatConfig?.apiV3KeyConfigured ? "已配置；留空不会更改" : "仅保存在桌面安全存储"} />
            </label>
            {!window.ogb?.setCredential && <p className="text-[12px] text-ink-secondary">APIv3密钥只能在桌面应用中通过系统安全存储设置。</p>}
            <div className="flex flex-wrap gap-2">
              <button type="button" className="ui-button ui-button-primary" disabled={busy !== null || !wechatKeyDraft.trim() || !window.ogb?.setCredential} onClick={() => void saveWechatApiV3Key()}>{busy === "wechat-key" ? "保存中…" : "保存APIv3密钥"}</button>
              {wechatConfig?.apiV3KeyConfigured && <button type="button" className="ui-button" disabled={busy !== null || !window.ogb?.setCredential} onClick={() => void saveWechatApiV3Key(true)}>清除已保存密钥</button>}
            </div>
            <label className="flex items-start gap-2 text-[12px] text-ink-secondary">
              <input data-wechat-enabled type="checkbox" className="mt-0.5" checked={wechatDraft.enabled} disabled={busy !== null || !wechatConfig?.ready} onChange={(event) => setWechatDraft({ ...wechatDraft, enabled: event.target.checked })} />
              <span>启用微信收款（需先保存完整商户资料和APIv3密钥）</span>
            </label>
            <button type="button" className="ui-button" disabled={busy !== null} onClick={() => void saveWechatConfig()}>{busy === "wechat-config" ? "保存中…" : "保存微信配置"}</button>
            {wechatNotice && <p role="status" className="text-[12px] text-ink-secondary">{wechatNotice}</p>}
          </div>
        </details>


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

function wechatFieldName(field: string): string {
  return ({
    appId: "应用AppID",
    merchantId: "商户号",
    merchantCertificatePath: "商户证书路径",
    privateKeyPath: "商户私钥路径",
    platformCertificatePath: "平台证书路径",
    platformSerialNo: "平台证书序列号",
    notifyUrl: "支付通知地址",
    apiV3Key: "APIv3密钥",
  } as Record<string, string>)[field] ?? field;
}

function membershipEndDate(raw: string): string {
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? "到期日期暂不可显示" : new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric" }).format(date);
}
