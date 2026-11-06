import { describe, expect, it } from "vitest";
import { resolveMbtiAvatar } from "./mbti-avatar";

describe("resolveMbtiAvatar", () => {
  it("uses an explicit MBTI code from the profile", () => {
    expect(resolveMbtiAvatar({ title: "INTJ 产品顾问" })).toMatchObject({ type: "INTJ", source: "explicit-mbti" });
  });

  it("prefers the configured AI persona marker over other MBTI mentions in soul", () => {
    expect(resolveMbtiAvatar({ soul: "AI性格配置（MBTI）：ENFP\n\nDiscuss INTP ideas when useful." }))
      .toMatchObject({ type: "ENFP", source: "configured-mbti" });
  });

  it("recommends a visual style from a clear role without claiming a measured type", () => {
    expect(resolveMbtiAvatar({ title: "团队负责人" })).toMatchObject({ type: "ENTJ", source: "role-recommendation" });
    expect(resolveMbtiAvatar({ title: "增长负责人" })).toMatchObject({ type: "ENTJ", source: "role-recommendation" });
    expect(resolveMbtiAvatar({ title: "开发专员" })).toMatchObject({ type: "INTJ", source: "role-recommendation" });
    expect(resolveMbtiAvatar({ title: "质量交付" })).toMatchObject({ type: "ISTJ", source: "role-recommendation" });
    expect(resolveMbtiAvatar({ title: "CEO 总智能体 · 总协调机器人" })).toMatchObject({ type: "ENTJ", source: "role-recommendation" });
    expect(resolveMbtiAvatar({ chiefOfStaff: true })).toMatchObject({ type: "ENTJ", source: "role-recommendation" });
  });

  it("keeps unknown or conflicting profiles without an MBTI avatar", () => {
    expect(resolveMbtiAvatar({ title: "新伙伴" })).toBeNull();
    expect(resolveMbtiAvatar({ description: "MBTI: INTJ or ENFP" })).toBeNull();
  });
});
