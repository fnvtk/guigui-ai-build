export const GUAI_SERVICE_TIERS = [
  { id: "kr-max", label: "Max", description: "更强，适合复杂任务" },
  { id: "kr-pro", label: "Pro", description: "均衡，适合日常工作" },
  { id: "kr-mini", label: "Mini", description: "更快，适合简单问题" },
] as const;
export type GuaiServiceTier = typeof GUAI_SERVICE_TIERS[number]["id"];

/** Legacy selections remain readable without exposing provider model identifiers. */
export function guaiServiceTier(model: string | undefined): GuaiServiceTier {
  if (model === "kr-max" || /astra/i.test(model ?? "")) return "kr-max";
  if (model === "kr-mini" || /luna|mini|spark/i.test(model ?? "")) return "kr-mini";
  return "kr-pro";
}
export function guaiServiceLabel(model: string | undefined): string {
  return GUAI_SERVICE_TIERS.find(tier => tier.id === guaiServiceTier(model))!.label;
}
