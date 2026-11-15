const NAMES = [
  "小满", "阿程", "阿策", "暖暖", "小板", "周砚修", "苏映川", "林知序",
  "顾慎行", "沈维舟", "阿桥", "若水", "知行", "明远", "清和", "安宁",
  "星河", "晨曦", "青禾", "云舟", "知夏", "南风", "听澜", "初晴",
  "嘉木", "砚台", "松涛", "远山", "微澜", "清川", "朝夕", "如一",
  "简宁", "言川", "亦安", "知微", "长风", "静姝", "景明", "乐言",
  "子衿", "明礼", "和光", "星野", "秋水", "白露", "锦书", "松月",
  "清越", "容与", "知衡", "听雨", "云深", "见山", "澄明", "望舒",
  "嘉言", "予安", "昭昭", "怀瑾", "致远", "清欢", "安澜", "知意",
];

export function pickBotName(taken: Iterable<string>): string {
  const used = new Set([...taken].map((n) => n.trim().toLowerCase()));
  const free = NAMES.filter((n) => !used.has(n.toLowerCase()));
  if (free.length > 0) return free[Math.floor(Math.random() * free.length)];
  const base = NAMES[Math.floor(Math.random() * NAMES.length)];
  for (let i = 2; ; i++) {
    if (!used.has(`${base.toLowerCase()} ${i}`)) return `${base} ${i}`;
  }
}

const PICKED = new Set(NAMES.map((name) => name.toLowerCase()));

/** A name pickBotName could have given ("Pesto", "Pesto 2"): New bot sends one from /api/bot-defaults' suggestedName. */
export function isPickedBotName(name: string): boolean {
  return PICKED.has(name.trim().toLowerCase().replace(/ \d+$/, ""));
}
