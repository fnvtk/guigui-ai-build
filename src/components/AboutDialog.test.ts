import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import { AboutDialog } from "./AboutDialog";

function about(page: object): string {
  vi.stubGlobal("window", page);
  return renderToStaticMarkup(createElement(AboutDialog, { open: true, onClose: () => {} }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  setLocale("en");
});

describe("About", () => {
  it("shows the current product name and the user's brand without version or upstream branding", () => {
    const html = about({ ogb: { app: { version: "0.1.127" } }, location: { host: "bots.example.test" } });
    expect(html).toContain("乖乖Ai");
    expect(html).toContain("卡若创业派对出品");
    expect(html).toContain("小程序搜「卡若创业派对」");
    expect(html).toContain("© 卡若创业派对");
    expect(html).not.toContain("0.1.127");
    expect(html).not.toContain("Version");
    expect(html).not.toContain("OpenMausBot");
    expect(html).not.toContain("MausBot");
  });

  it("removes license and third-party statement links from About", () => {
    setLocale("zh");
    const html = about({ location: { host: "bots.example.test" } });
    expect(html).not.toContain("开源声明");
    expect(html).not.toContain("许可证");
    expect(html).not.toContain("第三方声明");
    expect(html).not.toContain("Apache 2.0");
    expect(html).not.toContain("github.com/milind-soni/OpenMausBot");
    expect(html).toContain("关闭");
  });
});
