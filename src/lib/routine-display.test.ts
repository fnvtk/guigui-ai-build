import { describe, expect, it } from "vitest";

import { routineRunsOn } from "./routine-display";

describe("where a routine runs", () => {
  it("shows local execution for new and room routines regardless of cloud account", () => {
    expect(routineRunsOn({ roomGoal: false, cloudHome: false })).toEqual({
      label: "This computer", hint: "Starts while 乖乖Ai is open here.",
    });
    expect(routineRunsOn({ roomGoal: false, cloudHome: true })).toEqual({
      label: "This computer", hint: "Starts while 乖乖Ai is open here.",
    });
    expect(routineRunsOn({ roomGoal: true, cloudHome: true }).label).toBe("This computer, with the whole group");
  });

  it("marks old cloud and private desktop execution as disabled", () => {
    for (const input of [{ runOn: "cloud" }, { computer: "cloud" }, { computer: "vm" }]) {
      expect(routineRunsOn({ roomGoal: false, cloudHome: true, ...input })).toEqual({ label: "已停用的执行位置，请改为本机", hint: "" });
    }
  });
});
