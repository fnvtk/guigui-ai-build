import { useCallback, useRef, useState, type ReactNode } from "react";
import { useStore, type AppState, type Bot, type ModelSelection } from "@/state/store";
import type { EffortLevel } from "../../shared/wire";
import type { ModelVariantOption } from "../../shared/runtime-events";
import { modelSelectionForPick } from "@/lib/model-choices";
export { modelSelectionForPick } from "@/lib/model-choices";
import { usePopoverDismiss } from "@/hooks/use-popover-dismiss";
import { cn } from "@/lib/cn";
import { useOwnerOrAdmin } from "@/lib/use-owner-or-admin";
import { t } from "@/lib/i18n";
import { useAiSwitch } from "@/lib/ai-switch";
import { Select } from "./Select";
import { isSimpleApi } from "../../shared/ai-ranking";
import { GUAI_SERVICE_TIERS, guaiServiceLabel } from "../../shared/guai-service-tiers";

export function effortLabel(level: EffortLevel): string {
  return t(`model.effort.${level}` as Parameters<typeof t>[0]);
}

/**
 * Default (undefined) sends nothing and lets the engine decide; `none` is a level the engine is told to use. Only pi
 * offers both.
 */
export function EffortRow({
  bot,
  threadId,
  updateBotDefault,
  className,
  label,
  compact = false,
}: {
  bot: Bot;
  threadId?: string;
  updateBotDefault?: boolean;
  className?: string;
  label?: ReactNode;
  compact?: boolean;
}) {
  const { state, dispatch } = useStore();
  const selection = bot.modelSelection;
  const instance = state.instances.find((candidate) => candidate.instanceId === selection.instanceId);
  if (instance?.capabilities?.modelVariants) {
    return <ModelVariantRow bot={bot} threadId={threadId} updateBotDefault={updateBotDefault} className={className} label={label} compact={compact} quiet={compact} />;
  }
  const levels = instance?.capabilities?.effortLevels;
  if (!levels?.length) return null;

  if (compact) return (
    <label className={cn("flex items-center justify-between gap-3", className)}>
      {label}
      <Select size="sm" variant="quiet" className="max-w-[65%]" aria-label={t("model.effort.label")} value={selection.effort ?? ""}
        onChange={(event) => dispatch({ type: "setModel", botId: bot.id, threadId, ...(updateBotDefault ? { updateBotDefault: true } : {}),
          selection: { ...selection, effort: levels.find((level) => level === event.target.value) } })}>
        <option value="">{t("model.effort.default")}</option>
        {levels.map((level) => <option key={level} value={level}>{effortLabel(level)}</option>)}
      </Select>
    </label>
  );

  return (
    <div className={className}>
      {label}
      <div className="mt-2 flex flex-wrap gap-1" role="group" aria-label={t("model.effort.label")}>
        {[undefined, ...levels].map((level) => (
          <button
            key={level ?? "default"}
            type="button"
            aria-pressed={selection.effort === level}
            title={
              level === undefined
                ? t("model.effort.noLevel")
                : t("model.effort.ask", { level: effortLabel(level) })
            }
            onClick={() => dispatch({ type: "setModel", botId: bot.id, threadId, ...(updateBotDefault ? { updateBotDefault: true } : {}), selection: { ...selection, effort: level } })}
            className={cn(
              "rounded-full border px-2.5 py-1 text-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70",
              selection.effort === level
                ? "border-accent/60 bg-control text-ink"
                : "border-hairline/40 text-ink-secondary hover:bg-control/60 hover:text-ink",
            )}
          >
            {level === undefined ? t("model.effort.default") : effortLabel(level)}
          </button>
        ))}
      </div>
    </div>
  );
}

const variantLabel = (option: ModelVariantOption, driverKind?: string): string =>
  option.id === "default" && driverKind === "opencodeGo" ? t("model.variant.openCodeDefault") : option.label;

/** ACP variant ids are opaque; their model/session declares the available choices. */
function variantChoices(state: Pick<AppState, "instances" | "modelVariantSessions">, selection: ModelSelection, threadId: string | undefined) {
  const instance = state.instances.find((candidate) => candidate.instanceId === selection.instanceId);
  if (!instance?.capabilities?.modelVariants) return null;
  const session = threadId === undefined ? undefined : state.modelVariantSessions[threadId];
  const reported = session?.instanceId === selection.instanceId && session.model === selection.model ? session.variants : undefined;
  const options = reported?.options ?? instance.models.options.find((option) => option.id === selection.model)?.variants ?? [];
  if (!options.length && selection.variant === undefined) return null;
  return { instance, reported, options };
}

export function ModelVariantRow({ bot, threadId, updateBotDefault, className, label, compact = false, wide = false, quiet = false }: {
  bot: Bot;
  threadId?: string;
  updateBotDefault?: boolean;
  className?: string;
  label?: ReactNode;
  compact?: boolean;
  wide?: boolean;
  quiet?: boolean;
}) {
  const { state, dispatch } = useStore();
  const selection = bot.modelSelection;
  const choices = variantChoices(state, selection, threadId ?? bot.threadId);
  if (!choices) return null;
  const { instance, reported, options } = choices;
  const missing = selection.variant !== undefined && !options.some((option) => option.id === selection.variant);
  const unavailable = missing && reported !== undefined;
  const current = reported?.currentValue;
  const choose = (variant?: string) => {
    const { effort: _effort, variant: _variant, ...model } = selection;
    dispatch({ type: "setModel", botId: bot.id, threadId, ...(updateBotDefault ? { updateBotDefault: true } : {}),
      selection: { ...model, ...(variant !== undefined ? { variant } : {}) } });
  };
  if (compact) return (
    <div className={className}>
      <label className="flex items-center justify-between gap-3">
        {label}
        <Select size="sm" variant={quiet ? "quiet" : "field"} aria-label={t("model.variant.label")} disabled={bot.busy} className={wide ? "flex-1" : "max-w-[65%]"}
          value={selection.variant === undefined ? "unset" : missing ? "missing" : String(options.findIndex((option) => option.id === selection.variant))}
          onChange={(event) => choose(options[Number(event.target.value)]?.id)}>
          <option value="unset">{t("model.variant.session")}</option>
          {missing && <option value="missing" disabled>{selection.variant} ({unavailable ? t("model.variant.unavailable") : t("model.variant.unverified")})</option>}
          {options.map((option, index) => <option key={option.id} value={String(index)}>{variantLabel(option, instance.driverKind)}</option>)}
        </Select>
      </label>
      {missing && <p className={cn("mt-1 text-ink-secondary", quiet ? "text-[12px] leading-4 text-ink-tertiary" : "text-[11px]")}>{unavailable ? t("model.variant.unavailableHelp") : t("model.variant.unverifiedHelp")}</p>}
    </div>
  );
  return (
    <div className={className}>
      {label}
      {(selection.variant === undefined || missing) && (
        <p className="mt-2 text-[12px] text-ink-secondary">
          {unavailable ? t("model.variant.unavailableChoice", { variant: selection.variant ?? "" })
            : missing ? t("model.variant.unverifiedChoice", { variant: selection.variant ?? "" }) : t("model.variant.none")}
          {current !== undefined && ` ${t("model.variant.sessionValue", { variant: variantLabel(options.find((option) => option.id === current) ?? { id: current, label: current }, instance.driverKind) })}`}
        </p>
      )}
      {selection.variant !== undefined && (
        <button type="button" disabled={bot.busy} onClick={() => choose()}
          title={t("model.variant.clearHint")}
          className="mt-2 block text-[12px] text-ink-secondary underline underline-offset-2 hover:text-ink disabled:opacity-50">
          {t("model.variant.clear")}
        </button>
      )}
      {options.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1" role="group" aria-label={t("model.variant.label")}>
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              disabled={bot.busy}
              aria-pressed={selection.variant === option.id}
              title={t("model.variant.use", { variant: variantLabel(option, instance.driverKind) })}
              onClick={() => choose(option.id)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 disabled:opacity-50",
                selection.variant === option.id ? "border-accent/60 bg-control text-ink" : "border-hairline/40 text-ink-secondary hover:bg-control/60 hover:text-ink",
              )}
            >
              {variantLabel(option, instance.driverKind)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export const SIMPLE_POPOVER_WIDTH = 300;

export function ModelPicker({
  bot: shown,
  threadId,
  className,
  contained = false,
  label,
  size = "md",
}: {
  bot: Bot;
  threadId?: string;
  className?: string;
  contained?: boolean;
  label?: ReactNode;
  size?: "sm" | "md";
}) {
  const { state, dispatch: storeDispatch } = useStore();
  const [open, setOpen] = useState(false);
  const setPickerOpen = useCallback((next: boolean) => setOpen(next), []);
  const { bot, dispatch } = useAiSwitch({ bot: shown, threadId, contained, dispatch: storeDispatch, setOpen: setPickerOpen });
  const ownerOrAdmin = useOwnerOrAdmin();
  const instance = state.instances.find(isSimpleApi);
  const rootRef = useRef<HTMLDivElement | null>(null);
  usePopoverDismiss(open, rootRef, () => setOpen(false));
  const updateBotDefault = ownerOrAdmin === true;
  const tiers = GUAI_SERVICE_TIERS.filter((tier) => instance?.models.options.some((option) => option.id === tier.id));
  const selectedLabel = guaiServiceLabel(bot.modelSelection.model);

  const pick = (model: typeof GUAI_SERVICE_TIERS[number]["id"]) => {
    if (bot.busy || !instance) return;
    const selection = modelSelectionForPick(bot.modelSelection, instance, model);
    dispatch({
      type: "setModel",
      botId: bot.id,
      threadId: threadId ?? bot.threadId,
      updateBotDefault,
      selection: { instanceId: instance.instanceId, model: selection.model },
    });
    setOpen(false);
  };

  return (
    <div ref={rootRef} className={cn(contained ? "w-full" : "relative", className)}>
      {contained ? (
        <div className="flex items-center justify-between gap-4">
          {label}
          <button type="button" data-tour="model" aria-expanded={open} disabled={bot.busy} title={selectedLabel}
            onClick={() => setOpen((value) => !value)}
            className={cn("min-w-0 truncate rounded-lg border border-hairline/60 px-3 py-2 text-sm text-ink hover:bg-control disabled:opacity-50", size === "sm" && "px-2 py-1 text-xs")}>
            {selectedLabel}
          </button>
        </div>
      ) : (
        <button type="button" data-tour="model" aria-expanded={open} disabled={bot.busy} title={selectedLabel}
          onClick={() => setOpen((value) => !value)}
          className="rounded-lg border border-hairline/60 bg-panel px-3 py-2 text-sm text-ink hover:bg-control disabled:opacity-50">
          {selectedLabel}
        </button>
      )}
      {open && (
        <div data-model-picker-content role="dialog" aria-label="选择乖乖 AI 服务档位"
          className="menu-surface absolute right-0 top-full z-[80] mt-1 w-[min(300px,calc(100vw-2rem))] p-2">
          <div className="px-2 pb-2 pt-1 text-xs font-medium text-ink-secondary">选择服务档位</div>
          {!instance && <p role="status" className="px-2 pb-2 text-xs text-ink-tertiary">乖乖 AI 服务暂未连接</p>}
          {instance && tiers.length === 0 && <p role="status" className="px-2 pb-2 text-xs text-ink-tertiary">乖乖 AI 服务暂未提供可选档位</p>}
          <div className="grid gap-1">
            {tiers.map((tier) => (
              <button key={tier.id} type="button" data-service-tier={tier.id}
                aria-pressed={instance?.instanceId === bot.modelSelection.instanceId && tier.id === bot.modelSelection.model}
                disabled={!instance || bot.busy}
                onClick={() => pick(tier.id)}
                className="flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-control disabled:cursor-not-allowed disabled:opacity-50">
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-ink">{tier.label}</span>
                  <span className="block text-xs text-ink-tertiary">{tier.description}</span>
                </span>
                {instance?.instanceId === bot.modelSelection.instanceId && tier.id === bot.modelSelection.model &&
                  <span className="text-xs text-accent">当前</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
