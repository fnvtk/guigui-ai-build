import enfj from "@/assets/mbti-avatars-png-male/ENFJ.png";
import enfp from "@/assets/mbti-avatars-png-male/ENFP.png";
import entj from "@/assets/mbti-avatars-png-male/ENTJ.png";
import entp from "@/assets/mbti-avatars-png-male/ENTP.png";
import esfj from "@/assets/mbti-avatars-png-male/ESFJ.png";
import esfp from "@/assets/mbti-avatars-png-male/ESFP.png";
import estj from "@/assets/mbti-avatars-png-male/ESTJ.png";
import estp from "@/assets/mbti-avatars-png-male/ESTP.png";
import infj from "@/assets/mbti-avatars-png-male/INFJ.png";
import infp from "@/assets/mbti-avatars-png-male/INFP.png";
import intj from "@/assets/mbti-avatars-png-male/INTJ.png";
import intp from "@/assets/mbti-avatars-png-male/INTP.png";
import isfj from "@/assets/mbti-avatars-png-male/ISFJ.png";
import isfp from "@/assets/mbti-avatars-png-male/ISFP.png";
import istj from "@/assets/mbti-avatars-png-male/ISTJ.png";
import istp from "@/assets/mbti-avatars-png-male/ISTP.png";

export const MBTI_AVATAR_TYPES = [
  "INTJ", "INFJ", "ENTJ", "ENFJ", "ISTJ", "ISFJ", "ESTJ", "ESFJ",
  "ISTP", "ISFP", "ESTP", "ESFP", "INTP", "INFP", "ENTP", "ENFP",
] as const;

export type MbtiAvatarType = (typeof MBTI_AVATAR_TYPES)[number];
export type MbtiAvatarSource = "configured-mbti" | "explicit-mbti" | "role-recommendation";

const AVATAR_BY_TYPE: Record<MbtiAvatarType, string> = {
  INTJ: intj, INFJ: infj, ENTJ: entj, ENFJ: enfj,
  ISTJ: istj, ISFJ: isfj, ESTJ: estj, ESFJ: esfj,
  ISTP: istp, ISFP: isfp, ESTP: estp, ESFP: esfp,
  INTP: intp, INFP: infp, ENTP: entp, ENFP: enfp,
};

export const MBTI_ROLE_AVATAR_RECOMMENDATIONS = {
  leader: "ENTJ",
  product: "ENTJ",
  growth: "ENTJ",
  engineer: "INTJ",
  designer: "INFP",
  operator: "ESFJ",
  researcher: "INTP",
  quality: "ISTJ",
} as const satisfies Record<string, MbtiAvatarType>;

const MBTI_CODE = /(?<![A-Z])[EI][NS][FT][JP](?![A-Z])/gi;
const ROLE_PATTERNS: Record<keyof typeof MBTI_ROLE_AVATAR_RECOMMENDATIONS, RegExp> = {
  leader: /项目负责人|团队负责人|团队管理|总智能体|总协调机器人|\bCEO\b|chief of staff|project lead|team lead|leader/i,
  product: /产品经理|产品负责人|product manager/i,
  growth: /增长负责人|增长运营|增长专员|growth/i,
  engineer: /开发专员|开发工程师|前端开发|后端开发|developer|engineer/i,
  designer: /设计师|设计负责人|designer/i,
  operator: /运营|客服|客户成功|社群管理|operator/i,
  researcher: /研究员|分析师|researcher|analyst/i,
  quality: /质量交付|质量保障|测试工程师|测试开发|quality|\bqa\b|\bdelivery\b/i,
};

export function resolveMbtiAvatar(input: {
  title?: string | null;
  description?: string | null;
  soul?: string | null;
  chiefOfStaff?: boolean;
}): { type: MbtiAvatarType; image: string; source: MbtiAvatarSource } | null {
  const profileText = [input.title, input.description, input.soul].filter(Boolean).join("\n");
  const configuredType = input.soul?.match(/^AI性格配置（MBTI）：([EI][NS][FT][JP])\s*$/m)?.[1];
  if (configuredType && MBTI_AVATAR_TYPES.includes(configuredType as MbtiAvatarType)) {
    const type = configuredType as MbtiAvatarType;
    return { type, image: AVATAR_BY_TYPE[type], source: "configured-mbti" };
  }
  const explicitTypes = new Set([...profileText.matchAll(MBTI_CODE)].map((match) => match[0].toUpperCase()));
  if (explicitTypes.size === 1) {
    const type = [...explicitTypes][0] as MbtiAvatarType;
    return { type, image: AVATAR_BY_TYPE[type], source: "explicit-mbti" };
  }
  if (explicitTypes.size > 1) return null;

  if (input.chiefOfStaff) {
    const type = MBTI_ROLE_AVATAR_RECOMMENDATIONS.leader;
    return { type, image: AVATAR_BY_TYPE[type], source: "role-recommendation" };
  }

  const rolesIn = (text: string) => (Object.keys(ROLE_PATTERNS) as Array<keyof typeof ROLE_PATTERNS>)
    .filter((role) => ROLE_PATTERNS[role].test(text));
  const titleRoles = rolesIn(input.title ?? "");
  const roles = titleRoles.length ? titleRoles : rolesIn(input.description ?? "");
  if (roles.length !== 1) return null;

  const type = MBTI_ROLE_AVATAR_RECOMMENDATIONS[roles[0]];
  return { type, image: AVATAR_BY_TYPE[type], source: "role-recommendation" };
}
