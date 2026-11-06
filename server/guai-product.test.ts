import { describe, expect, it } from "vitest";
import { GUAI_MODEL_CATALOG, guaiUpstreamModel } from "./guai-model-routing.ts";
import { guaiSurfacePlan, guaiRemovedDesktopPath, guaiOffersSurface } from "./guai-local-product.ts";
import { startupBackups } from "./automatic-recovery.ts";
import { quotaSwitchEnabled } from "./quota-switch.ts";
import { instanceConfigs, type AppConfig } from "./config.ts";

describe("local product contracts", () => {
  it("publishes only three service aliases while resolving real upstream models on the host", () => {
    expect(GUAI_MODEL_CATALOG.options.map(row => row.id)).toEqual(["kr-max", "kr-pro", "kr-mini"]);
    expect(JSON.stringify(GUAI_MODEL_CATALOG)).not.toMatch(/gpt-|sol|terra|luna|astra/);
    expect(guaiUpstreamModel("kr-pro")).toBe("gpt-6.1-terra");
    expect(guaiUpstreamModel("kr-mini")).toBe("gpt-6-luna");
    expect(guaiUpstreamModel("kr-max")).toBe("gpt-6-astra");
    expect(guaiUpstreamModel("gpt-5.6-luna")).toBe("gpt-6-luna");
  });
  it("uses the existing gateway credentials only and removes other runtime providers", () => {
    const config = { instances: {
      gateway: { driver: "openai-compat", displayName: "SimpleAPI", config: { url: "https://gateway.example/v1", apiKeyEnv: "PRIVATE_EXISTING_GATEWAY_KEY" } },
      other: { driver: "codex", displayName: "Other AI" },
    } } as AppConfig;
    const result = instanceConfigs(config);
    expect(Object.keys(result)).toEqual(["gateway"]);
    expect(result.gateway.config).toMatchObject({ guaiTiers: true, url: "https://gateway.example/v1", apiKeyEnv: "PRIVATE_EXISTING_GATEWAY_KEY" });
    expect(config.instances!.other).toBeDefined();
    expect(instanceConfigs({} as AppConfig).simpleapi).toMatchObject({ driver: "openai-compat", displayName: "SimpleAPI" });
  });
  it("never starts a removed desktop or upgrades its permission to the person's Mac", () => {
    for (const destination of [undefined, "cloud", "vm"] as const) {
      expect(guaiSurfacePlan({ destination, browserOn: true })).toMatchObject({ computer: "off", browser: true });
    }
    expect(guaiSurfacePlan({ destination: "local", browserOn: true }).computer).toBe("local");
    expect(guaiSurfacePlan({ destination: "off", browserOn: true })).toMatchObject({ computer: "off", browser: false });
    expect(guaiSurfacePlan({ destination: undefined, pinnedSurface: "vm", browserOn: false }).browser).toBe(false);
    expect(["local", "browser", "cloud", "vm"].filter(value => guaiOffersSurface(value as "local" | "browser" | "cloud" | "vm"))).toEqual(["local", "browser"]);
  });
  it("refuses removed lifecycle endpoints but leaves Mac, files and browser routes untouched", () => {
    for (const path of ["/api/team-computers", "/api/computers/boxes", "/api/computers/vps/x/remove", "/api/local-computer/start", "/api/bots/a/local-computer", "/api/bots/a/computer/provision"]) expect(guaiRemovedDesktopPath(path)).toBe(true);
    for (const path of ["/api/cua/status", "/api/bots/a/browser", "/api/guai-billing/config", "/api/mcp/servers"]) expect(guaiRemovedDesktopPath(path)).toBe(false);
  });
  it("never activates retained backup AI data", () => {
    expect(startupBackups({ fallback: [{ instanceId: "other", model: "other" }] }, { enabled: true, backup: { instanceId: "other", model: "other" } })).toEqual([]);
    expect(quotaSwitchEnabled({ OMB_QUOTA_SWITCH: "1" })).toBe(false);
  });
});
