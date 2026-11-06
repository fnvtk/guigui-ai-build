import type { Bot, InstanceInfo } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { guaiServiceLabel } from "../../shared/guai-service-tiers";

export function botModel(bot: Pick<Bot, "modelSelection">, instances: InstanceInfo[]): { instance: InstanceInfo; label: string } | null {
  const instance = instances.find((item) => item.instanceId === bot.modelSelection.instanceId);
  if (!instance) return null;
  return { instance, label: guaiServiceLabel(bot.modelSelection.model || instance.models?.default) };
}

export function botTooltip(bot: Pick<Bot, "name" | "title" | "chiefOfStaff" | "modelSelection">, instances: InstanceInfo[]): string {
  const model = botModel(bot, instances);
  return [
    bot.name,
    bot.title.trim(),
    bot.chiefOfStaff ? t("sidebar.bot.chiefOfStaff") : "",
    model ? `服务档位：${model.label}` : "",
  ].filter(Boolean).join(" · ");
}

export function BotModelBadge({ bot, instances, avatarSize }: {
  bot: Pick<Bot, "modelSelection">;
  instances: InstanceInfo[];
  avatarSize: number;
}) {
  const model = botModel(bot, instances);
  if (!model) return null;
  const size = Math.max(14, Math.round(avatarSize * 0.4));
  const description = `服务档位：${model.label}`;
  const compact = model.label === "Max" ? "Mx" : model.label === "Mini" ? "Mi" : "P";
  return (
    <span data-testid="model-badge" role="img" aria-label={description} title={model.label}
      className="absolute -bottom-0.5 -left-0.5 flex items-center justify-center rounded-full border-2 border-panel bg-panel"
      style={{ width: size, height: size }}>
      <span aria-hidden="true" className="text-[7px] font-bold leading-none">{compact}</span>
    </span>
  );
}

/** Compact service-tier mark used where a bot's model is shown. */
export function BotEngineMark({ bot, instances, className }: { bot: Pick<Bot, "modelSelection">; instances: InstanceInfo[]; className?: string }) {
  const model = botModel(bot, instances);
  if (!model) return null;
  return (
    <span data-testid="model-badge" role="img" aria-label={`服务档位：${model.label}`}
      className={cn("flex shrink-0", className)}>
      <span aria-hidden="true" className="text-[10px] font-semibold">{model.label}</span>
    </span>
  );
}
