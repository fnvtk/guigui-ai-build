import { describe, expect, it } from "vitest";
import {
  LOGIN_STAY_GUIDANCE,
  loginFailureShouldStay,
  loginNextAction,
  withLoginStayGuidance,
} from "./credential-stay.ts";

describe("credential stay-in-place login flow", () => {
  it("keeps the turn open when no saved login exists and asks for in-app input, not chat secrets", () => {
    expect(loginFailureShouldStay("No saved login for xmfangchan.com. Open that site's login page, or call request_sign_in so the person signs in.")).toBe(true);
    expect(loginNextAction({ fillOk: false, hasSavedLoginForHost: false })).toBe("keep_sign_in_open");
    const text = withLoginStayGuidance("No saved login for xmfangchan.com.");
    expect(text).toContain("No saved login for xmfangchan.com.");
    expect(text).toContain("never paste a password into the chat");
    expect(text).toContain("in-app input on the sign-in card");
    expect(text).toContain("Do not end or leave this unfinished login");
    expect(LOGIN_STAY_GUIDANCE).not.toMatch(/password is|password:/i);
    expect(LOGIN_STAY_GUIDANCE).toContain("retry fill_login first");
    expect(LOGIN_STAY_GUIDANCE).toContain("do not invent a username such as \"admin\"");
    expect(LOGIN_STAY_GUIDANCE).toContain("do not only wait for a person");
  });

  it("retries fill_login from the saved store when a login already exists for the host", () => {
    expect(loginNextAction({ fillOk: false, hasSavedLoginForHost: true })).toBe("retry_fill_login");
    expect(loginNextAction({ fillOk: true, hasSavedLoginForHost: true })).toBe("done");
  });

  it("does not append stay guidance twice", () => {
    const once = withLoginStayGuidance("Could not fill the login.");
    expect(withLoginStayGuidance(once)).toBe(once);
  });
});
