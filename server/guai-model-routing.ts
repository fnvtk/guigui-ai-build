import { guaiServiceTier, GUAI_SERVICE_TIERS } from "../shared/guai-service-tiers.ts";
import type { ModelCatalog } from "./contracts.ts";

/** Private routing; real provider IDs never enter the public tier catalog. */
const UPSTREAM_MODELS = { "kr-max": "gpt-6-astra", "kr-pro": "gpt-6.1-terra", "kr-mini": "gpt-6-luna" } as const;
export const GUAI_MODEL_CATALOG: ModelCatalog = {
  default: "kr-pro",
  options: GUAI_SERVICE_TIERS.map(tier => ({ id: tier.id, label: tier.label, custom: true })),
};
export function guaiUpstreamModel(selection: string): string {
  return UPSTREAM_MODELS[guaiServiceTier(selection)];
}
