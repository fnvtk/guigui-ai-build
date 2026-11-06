import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";

const fixture = vi.hoisted(() => ({
  state: { instances: [], config: undefined as unknown },
  dispatch: vi.fn(),
}));

vi.mock("@/state/store", () => ({ useStore: () => ({ state: fixture.state, dispatch: fixture.dispatch }) }));
vi.mock("./BotEditorContext", () => ({ useBotEditor: () => ({ draft: false }) }));
vi.mock("./ProposalStatus", () => ({ ProposalStatus: () => null }));
vi.mock("../ThreadModelsLine", () => ({ ThreadModelsLine: () => null }));
vi.mock("../ModelPicker", () => ({
  ModelPicker: ({ bot }: { bot: Bot }) => createElement("div", { "data-primary-model": bot.modelSelection.model }, "主模型"),
  EffortRow: () => null,
}));

import { ModelSection } from "./ModelSection";

const bot = {
  id: "bot-1",
  modelSelection: { instanceId: "primary", model: "main-model" },
  fallback: [{ instanceId: "backup-ai", model: "backup-model" }],
} as unknown as Bot;

describe("a bot's model settings", () => {
  it("keeps the primary model picker and does not expose backup add or selection controls", () => {
    const html = renderToStaticMarkup(createElement(ModelSection, { bot }));
    expect(html).toContain('data-primary-model="main-model"');
    expect(html).toContain("主模型");
    expect(html).not.toContain("备选 AI");
    expect(html).not.toContain("备用模型");
    expect(html).not.toContain("添加备用 AI");
    expect(html).not.toContain("backup-ai");
    expect(html).not.toContain("backup-model");
    expect(fixture.dispatch).not.toHaveBeenCalled();
  });
});
