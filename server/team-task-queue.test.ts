import { describe, expect, it } from "vitest";
import {
  applyReceipt,
  chiefShouldKeepWorking,
  enqueueTeamTask,
  hasPendingReceipts,
  readyParallelTasks,
  registerWaitForReceipt,
  registerKaruoRunWait,
  karuoReplayKey,
  type TeamQueueTask,
} from "./team-task-queue.ts";

const task = (partial: Partial<TeamQueueTask> & Pick<TeamQueueTask, "id" | "title">): TeamQueueTask => ({
  status: "queued",
  createdAt: 1,
  ...partial,
});

describe("team task queue (卡若AI form)", () => {
  it("adds new work to the queue and does not recreate an existing task id", () => {
    const first = enqueueTeamTask([], { id: "t1", title: "补采", dri: "小满" }, 10);
    expect(first).toHaveLength(1);
    const again = enqueueTeamTask(first, { id: "t1", title: "补采-重复" }, 11);
    expect(again).toHaveLength(1);
    expect(again[0].title).toBe("补采");
    const second = enqueueTeamTask(again, { id: "t2", title: "验收", dri: "阿衡" }, 12);
    expect(second.map((item) => item.id)).toEqual(["t1", "t2"]);
  });

  it("registers a wait for 回执 and keeps other independent tasks ready", () => {
    let queue = [
      task({ id: "login", title: "登录后台", dri: "阿程", status: "running" }),
      task({ id: "poll", title: "轮询补采", dri: "小满" }),
      task({ id: "copy", title: "用户运营", dri: "暖暖" }),
    ];
    queue = registerWaitForReceipt(queue, "poll", "login");
    expect(queue.find((item) => item.id === "poll")).toMatchObject({ status: "waiting_receipt", waitingOn: "login" });
    expect(hasPendingReceipts(queue)).toBe(true);
    const ready = readyParallelTasks(queue).map((item) => item.id);
    expect(ready).toEqual(["copy"]);
    expect(chiefShouldKeepWorking(queue)).toBe(true);
  });

  it("resumes a waiting task after the receipt arrives", () => {
    let queue = [task({ id: "poll", title: "轮询补采", dri: "小满" })];
    queue = registerWaitForReceipt(queue, "poll", "acheng");
    queue = applyReceipt(queue, "acheng", "只读：尚无补采回执");
    const poll = queue.find((item) => item.id === "poll")!;
    expect(poll.status).toBe("queued");
    expect(poll.receipt).toBe("只读：尚无补采回执");
    expect(poll.waitingOn).toBeUndefined();
    expect(readyParallelTasks(queue).map((item) => item.id)).toEqual(["poll"]);
  });

  it("does not start dependent or over-capacity DRI work in parallel", () => {
    const queue = [
      task({ id: "a", title: "A", dri: "dev", status: "running" }),
      task({ id: "b", title: "B", dri: "dev" }),
      task({ id: "c", title: "C", dri: "dev" }),
      task({ id: "d", title: "D", dri: "qa", dependsOn: ["a"] }),
      task({ id: "e", title: "E", dri: "qa" }),
    ];
    expect(readyParallelTasks(queue).map((item) => item.id)).toEqual(["b", "e"]);
  });

  it("does not tell the chief to stop just because one teammate is being waited on", () => {
    const onlyWaiting = [task({ id: "w", title: "等回执", status: "waiting_receipt", waitingOn: "x" })];
    expect(chiefShouldKeepWorking(onlyWaiting)).toBe(false);
    expect(hasPendingReceipts(onlyWaiting)).toBe(true);
    const withReady = [...onlyWaiting, task({ id: "y", title: "其他任务", dri: "策" })];
    expect(chiefShouldKeepWorking(withReady)).toBe(true);
  });

  it("registers a 卡若 run wait with the original runId and idempotency key and never invents a new key", () => {
    let queue = [task({ id: "site", title: "网站任务", dri: "前端" })];
    queue = registerKaruoRunWait(queue, "site", { runId: "run-abc", idempotencyKey: "idem-1" });
    const site = queue.find((item) => item.id === "site")!;
    expect(site.status).toBe("waiting_receipt");
    expect(site.waitingOn).toBe("run-abc");
    expect(karuoReplayKey(site)).toBe("idem-1");
    queue = applyReceipt(queue, "run-abc", "ok");
    expect(queue.find((item) => item.id === "site")!.idempotencyKey).toBe("idem-1");
  });
});
