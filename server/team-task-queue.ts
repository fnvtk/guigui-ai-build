/**
 * Team task form aligned with the bound 卡若AI website collaboration protocol:
 * new work joins the team queue; independent tasks run in parallel; a busy
 * teammate is registered as a wait for 回执, and leftover ready work continues.
 */
export type TeamTaskStatus = "queued" | "running" | "waiting_receipt" | "done" | "blocked";

export interface TeamQueueTask {
  id: string;
  title: string;
  /** 主责任人 (DRI). */
  dri?: string;
  dependsOn?: string[];
  status: TeamTaskStatus;
  /** Teammate or task id whose receipt this item is waiting on. */
  waitingOn?: string;
  receipt?: string;
  /** Original 卡若 run idempotency key; never replace when retrying. */
  idempotencyKey?: string;
  createdAt: number;
}

export const MAX_IN_FLIGHT_PER_DRI = 2;

export function enqueueTeamTask(
  queue: readonly TeamQueueTask[],
  task: Omit<TeamQueueTask, "status" | "createdAt"> & Partial<Pick<TeamQueueTask, "status" | "createdAt">>,
  now = Date.now(),
): TeamQueueTask[] {
  if (queue.some((item) => item.id === task.id)) return [...queue];
  return [
    ...queue,
    {
      ...task,
      dependsOn: task.dependsOn ?? [],
      status: task.status ?? "queued",
      createdAt: task.createdAt ?? now,
    },
  ];
}

export function registerWaitForReceipt(
  queue: readonly TeamQueueTask[],
  taskId: string,
  waitingOn: string,
): TeamQueueTask[] {
  return queue.map((item) =>
    item.id === taskId && item.status !== "done"
      ? { ...item, status: "waiting_receipt", waitingOn, receipt: undefined }
      : item,
  );
}

export function applyReceipt(
  queue: readonly TeamQueueTask[],
  waitingOn: string,
  receipt: string,
): TeamQueueTask[] {
  return queue.map((item) => {
    if (item.status !== "waiting_receipt" || item.waitingOn !== waitingOn) return item;
    return { ...item, receipt, status: "queued", waitingOn: undefined };
  });
}

function unmetDependencies(queue: readonly TeamQueueTask[], task: TeamQueueTask): boolean {
  const done = new Set(queue.filter((item) => item.status === "done").map((item) => item.id));
  return (task.dependsOn ?? []).some((id) => !done.has(id));
}

/** Tasks that can run now without blocking the whole team on a teammate wait. */
export function readyParallelTasks(
  queue: readonly TeamQueueTask[],
  opts?: { maxInFlightPerDri?: number },
): TeamQueueTask[] {
  const cap = opts?.maxInFlightPerDri ?? MAX_IN_FLIGHT_PER_DRI;
  const runningByDri = new Map<string, number>();
  for (const item of queue) {
    if (item.status === "running" && item.dri) {
      runningByDri.set(item.dri, (runningByDri.get(item.dri) ?? 0) + 1);
    }
  }
  const ready: TeamQueueTask[] = [];
  for (const item of queue) {
    if (item.status !== "queued") continue;
    if (unmetDependencies(queue, item)) continue;
    if (item.dri && (runningByDri.get(item.dri) ?? 0) >= cap) continue;
    ready.push(item);
    if (item.dri) runningByDri.set(item.dri, (runningByDri.get(item.dri) ?? 0) + 1);
  }
  return ready;
}

/** A teammate wait must never idle the chief while other ready work remains. */
export function chiefShouldKeepWorking(queue: readonly TeamQueueTask[]): boolean {
  if (queue.some((item) => item.status === "running")) return true;
  return readyParallelTasks(queue).length > 0;
}

export function hasPendingReceipts(queue: readonly TeamQueueTask[]): boolean {
  return queue.some((item) => item.status === "waiting_receipt");
}


export interface KaruoRunRef {
  runId: string;
  idempotencyKey: string;
}

/** Accepted is not done: record the original run id and idempotency key and wait for 回执. */
export function registerKaruoRunWait(
  queue: readonly TeamQueueTask[],
  taskId: string,
  run: KaruoRunRef,
): TeamQueueTask[] {
  return queue.map((item) =>
    item.id === taskId && item.status !== "done"
      ? {
          ...item,
          status: "waiting_receipt" as const,
          waitingOn: run.runId,
          receipt: undefined,
          idempotencyKey: run.idempotencyKey,
        }
      : item,
  );
}

export function karuoReplayKey(task: TeamQueueTask & { idempotencyKey?: string }): string | undefined {
  return task.idempotencyKey;
}
