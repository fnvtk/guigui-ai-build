import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const release = resolve(process.cwd(), "release");
if (existsSync(release)) rmSync(release, { recursive: true, force: true });
console.log(`Cleared previous release output: ${release}`);
