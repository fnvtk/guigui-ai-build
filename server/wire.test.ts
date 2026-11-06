import { describe, expect, it } from "vitest";

import {
  botWireProjectionIsExact,
  groupWireProjectionIsExact,
  toPublicModelSelection,
  toWireTask,
  type BotRecord,
  type GroupRecord,
  type Message,
  type TaskRecord,
} from "./store.ts";
import type { WireBot, WireGroup, WireMessage, WireTask } from "../shared/wire.ts";

const fullTask: TaskRecord = {
  threadId: "thread-1",
  title: "Wire projection",
  createdAt: 1234,
  projectId: "proj",
  routineRunId: "run-1",
  openedBy: { botId: "b1", name: "Opener", delegationId: "d1", kind: "pair", at: 1 },
  closedBy: { botId: "b1", name: "Opener", at: 2 },
  archivedAt: 3,
  modelSelection: { instanceId: "claude", model: "m", effort: "high" },
  approvalMode: "ask",
  autoApprove: true,
  alwaysAllow: ["tool"],
  unread: true,
  rewound: true,
  pinnedMessageId: "msg-1",
  activity: "working",
  busy: true,
  surface: "cloud",
  usage: { input: 1, output: 2, cachedInput: 1, costUsd: null, turns: 1, lastTurn: { input: 1, output: 2, costUsd: null }, context: { tokens: 10, window: 100 } },
  cwd: "/tmp",
  resumeCursors: { claude: "cursor" },
  lastInstanceId: "claude",
};
const botModel = { instanceId: "codex", model: "bot-model" };

describe("shared wire model", () => {
  it("toWireTask emits exactly the WireTask key set and never the server-private fields", () => {
    const wire = toWireTask(fullTask, botModel);
    expect(Object.keys(wire).sort()).toEqual([
      "activity", "alwaysAllow", "approvalMode", "archivedAt", "autoApprove",
      "busy", "closedBy", "createdAt", "cwd", "followsBotModel", "modelSelection", "openedBy",
      "pinnedMessageId", "projectId", "rewound", "routineRunId", "surface",
      "threadId", "title", "unread", "usage",
    ]);
    expect(wire).not.toHaveProperty("resumeCursors");
    expect(wire).not.toHaveProperty("lastInstanceId");
    const { resumeCursors: _resumeCursors, lastInstanceId: _lastInstanceId, ...storedWireFields } = fullTask;
    expect(wire).toEqual({ ...storedWireFields, modelSelection: { ...fullTask.modelSelection, model: "kr-pro" }, followsBotModel: false });
    expect(fullTask.resumeCursors).toEqual({ claude: "cursor" });
    expect(fullTask.lastInstanceId).toBe("claude");
  });

  it("tells a client only whether a surface pin is the machine's own record", () => {
    expect(toWireTask({ ...fullTask, surfaceSource: "auto" }, botModel)).toEqual({ ...toWireTask(fullTask, botModel), surfaceAuto: true });
    expect(toWireTask({ ...fullTask, surfaceSource: "user" }, botModel)).not.toHaveProperty("surfaceAuto");
    expect(toWireTask(fullTask, botModel)).not.toHaveProperty("surfaceAuto");
    expect(toWireTask({ ...fullTask, surface: undefined, surfaceSource: "auto" }, botModel)).not.toHaveProperty("surfaceAuto");
    for (const surfaceSource of ["auto", "user"] as const) {
      expect(toWireTask({ ...fullTask, surfaceSource }, botModel)).not.toHaveProperty("surfaceSource");
    }
  });

  it("sends the model a thread runs on, and whether it follows its bot's", () => {
    const { modelSelection: _own, ...follower } = fullTask;
    expect(toWireTask(follower, botModel)).toMatchObject({ modelSelection: { ...botModel, model: "kr-pro" }, followsBotModel: true });
    expect(toWireTask(fullTask, botModel)).toMatchObject({ modelSelection: { ...fullTask.modelSelection, model: "kr-pro" }, followsBotModel: false });
  });

  it("projects known Guai GPT model IDs to public aliases without mutating stored selections", () => {
    const expected = [
      ["gpt-6-astra", "kr-max"],
      ["gpt-6.1-terra", "kr-pro"],
      ["gpt-6-luna", "kr-mini"],
    ] as const;
    for (const [internal, publicId] of expected) {
      const selection = { instanceId: "simpleapi", model: internal, effort: "high" as const, variant: "fast" };
      const projected = toPublicModelSelection(selection);
      expect(projected).toEqual({ ...selection, model: publicId });
      expect(selection.model).toBe(internal);
    }
    const unrelated = { instanceId: "custom", model: "vendor-model", effort: "low" as const };
    expect(toPublicModelSelection(unrelated)).toEqual({ ...unrelated, model: "kr-pro" });
    expect(toPublicModelSelection(unrelated)).not.toBe(unrelated);
  });

  it("projects legacy and unknown nonempty IDs to the shared public service tier", () => {
    const cases = [
      ["gpt-5.6-luna", "kr-mini"],
      ["gpt-5.6-sol", "kr-pro"],
      ["kr-max", "kr-max"],
      ["kr-pro", "kr-pro"],
      ["kr-mini", "kr-mini"],
      ["unrecognized-upstream-id", "kr-pro"],
    ] as const;
    for (const [internal, publicId] of cases) {
      expect(toPublicModelSelection({ instanceId: "simpleapi", model: internal })).toEqual({
        instanceId: "simpleapi", model: publicId,
      });
    }
    expect(toPublicModelSelection({ instanceId: "simpleapi", model: "" })).toEqual({
      instanceId: "simpleapi", model: "",
    });
  });

  it("projects aliases on both explicit task models and inherited bot models", () => {
    const internalTaskModel = { instanceId: "simpleapi", model: "gpt-6.1-terra", effort: "high" as const };
    const internalBotModel = { instanceId: "simpleapi", model: "gpt-6-luna", effort: "low" as const };
    const explicit = toWireTask({ ...fullTask, modelSelection: internalTaskModel }, internalBotModel);
    expect(explicit.modelSelection).toEqual({ ...internalTaskModel, model: "kr-pro" });
    expect(internalTaskModel.model).toBe("gpt-6.1-terra");
    const { modelSelection: _own, ...follower } = fullTask;
    expect(toWireTask(follower, internalBotModel).modelSelection).toEqual({ ...internalBotModel, model: "kr-mini" });
    expect(internalBotModel.model).toBe("gpt-6-luna");
  });

  it("bot and group wire projections stay exact (compile-enforced)", () => {
    // Referencing the guard constants keeps the exactness assertions live.
    expect(botWireProjectionIsExact).toBe(true);
    expect(groupWireProjectionIsExact).toBe(true);
  });

  it("server records stay assignable to the shared wire shapes (compile-enforced)", () => {
    const task: WireTask = fullTask;
    const message: Message = { id: "m", role: "bot", kind: "text", text: "hi", at: 1 };
    const wireMessage: WireMessage = message;
    const group: GroupRecord = {
      id: "g", threadId: "t", name: "room", memberIds: [], defaultResponder: { kind: "everyone" },
      bulletin: "", unread: false, createdAt: 1,
    };
    const wireGroup: WireGroup = { ...group, working: true };
    const bot: BotRecord = {
      id: "b", threadId: "t", name: "Bot", title: "", description: "", notifications: true,
      color: "green", unread: false, modelSelection: { instanceId: "claude", model: "m" },
      resumeCursors: {}, createdAt: 1,
    };
    const wireBot: WireBot = { ...bot, avatarUrl: bot.avatarUrl ?? null, tasks: [] };
    expect([task.threadId, wireMessage.role, wireGroup.working, wireBot.avatarUrl]).toEqual(["thread-1", "bot", true, null]);
  });
});
