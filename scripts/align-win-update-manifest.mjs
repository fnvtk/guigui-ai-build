import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { parse, stringify } from "yaml";

const version = JSON.parse(readFileSync("package.json", "utf8")).version;
const releaseDir = resolve(process.argv[2] ?? "release");
const installers = readdirSync(releaseDir).filter((name) => name.endsWith(".exe") && !name.endsWith(".blockmap"));
if (installers.length !== 1) throw new Error(`Expected one Windows installer, found ${installers.length}`);

const installer = resolve(releaseDir, installers[0]);
const contents = readFileSync(installer);
const assetName = basename(installer).replace(/^乖乖/, "");
const sha512 = createHash("sha512").update(contents).digest("base64");
const manifestPath = resolve(releaseDir, "latest.yml");
const manifest = parse(readFileSync(manifestPath, "utf8"));
if (manifest.version !== version || manifest.files?.length !== 1) {
  throw new Error(`Unexpected Windows update manifest for ${version}`);
}

manifest.files[0] = { ...manifest.files[0], url: assetName, sha512, size: statSync(installer).size };
manifest.path = assetName;
manifest.sha512 = sha512;
writeFileSync(manifestPath, stringify(manifest));
console.log(`Aligned Windows update manifest: ${assetName}`);
