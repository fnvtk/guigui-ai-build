import { describe, expect, it } from "vitest";

import { availableTools, catalogProfileFromEnv } from "./agents-catalog.ts";

describe("local product computer tool catalog", () => {
  it("does not advertise VM execution and limits computer choices to auto, local and browser", () => {
    for (const env of [
      { OMB_COMPUTER_SELECTION: "1" },
      { OMB_COMPUTER_SELECTION: "1", OMB_CLOUD_HOME: "1" },
    ]) {
      const tools = availableTools(catalogProfileFromEnv({ OMB_BOT_ID: "catalog-test", ...env }));
      expect(tools.map((tool) => tool.name)).not.toContain("vm_exec");
      const select = tools.find((tool) => tool.name === "select_computer");
      const properties = (select?.inputSchema as { properties?: Record<string, unknown> } | undefined)?.properties;
      expect(properties?.surface).toMatchObject({
        type: "string",
        enum: ["auto", "local", "browser"],
      });
      expect(select?.description).not.toMatch(/provision|boat|cloud computer|vps|local vm/i);
    }
  });
});
