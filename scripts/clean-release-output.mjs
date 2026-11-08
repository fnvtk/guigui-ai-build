import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const release = resolve(process.cwd(), "release");
if (process.env.OMB_KEEP_RELEASE_OUTPUT === "1") {
  console.log(`Keeping existing release output for the next platform: ${release}`);
} else {
  if (existsSync(release)) rmSync(release, { recursive: true, force: true });
  console.log(`Cleared previous release output: ${release}`);
}
