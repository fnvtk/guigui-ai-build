import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export default async function afterSign(context) {
  if (context.electronPlatformName !== "darwin" || process.env.CSC_IDENTITY_AUTO_DISCOVERY !== "false") return;

  const app = path.join(context.appOutDir, `${context.packager.appInfo.productName}.app`);
  if (!existsSync(app)) throw new Error(`macOS app bundle is missing after signing: ${app}`);
  execFileSync("/usr/bin/codesign", ["--deep", "--force", "--sign", "-", app], { stdio: "inherit" });
  execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", app], { stdio: "inherit" });
}
