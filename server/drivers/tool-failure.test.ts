import { describe, expect, it } from "vitest";

import { classifyContinuable } from "../turn-continuation.ts";
import { toolFailureMessage } from "./tool-failure.ts";

const AFTER_FAILURE = "The bot's reply isn't proof the work was done; the failed step shows the error.";

describe("why a chat turn stopped on a tool call", () => {
  it("names the call that failed", () => {
    expect(toolFailureMessage(["composio_CLARITY_GET_INSIGHTS"], [])).toBe(`Stopped because the tool call “composio_CLARITY_GET_INSIGHTS” failed. ${AFTER_FAILURE}`);
  });

  it("tells a call that wasn't allowed apart from one that failed", () => {
    expect(toolFailureMessage(["gmail_send"], ["gmail_send"]))
      .toBe("Stopped because the tool call “gmail_send” wasn't allowed. The bot's reply isn't proof the work was done; that step didn't run.");
    expect(toolFailureMessage(["gmail_send", "notion_search"], ["gmail_send"]))
      .toBe(`Stopped because the tool call “notion_search” failed and “gmail_send” wasn't allowed. ${AFTER_FAILURE}`);
  });

  it("names each call once and at most three", () => {
    expect(toolFailureMessage(["a", "b", "a"], [])).toBe(`Stopped because the tool calls “a” and “b” failed. ${AFTER_FAILURE}`);
    expect(toolFailureMessage(["a", "b", "c", "d", "e"], [])).toBe(`Stopped because the tool calls “a”, “b”, “c” and 2 more failed. ${AFTER_FAILURE}`);
    expect(toolFailureMessage(["x".repeat(200)], [])).toContain(`“${"x".repeat(79)}…”`);
  });

  it("is never read as a spent turn budget, which would continue the run by itself", () => {
    expect(classifyContinuable("tool_error", toolFailureMessage(["stopped after 3 steps"], []))).toBeNull();
  });

  it("adds a recovery path for computer, hand-off and page failures", () => {
    expect(toolFailureMessage(["select_computer"], [])).toContain("call select_computer with no arguments");
    expect(toolFailureMessage(["coordinate_bots"], [])).toContain("call list_bots or list_room_targets");
    expect(toolFailureMessage(["agents_show_html"], [])).toContain("call show_html with html, jsx or path");
    expect(toolFailureMessage(["agent_browser_wait_for_text"], [])).toContain("treat the page result as unverified");
    expect(toolFailureMessage(["browser_agent_browser_click"], [])).toContain("confirm the target still exists");
    expect(toolFailureMessage(["agents_coordinate_bots", "browser_agent_browser_click"], [])).toContain("call list_bots or list_room_targets");
    expect(toolFailureMessage(["agents_coordinate_bots", "browser_agent_browser_click"], [])).toContain("confirm the target still exists");
  });
});
