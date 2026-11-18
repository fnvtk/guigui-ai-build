import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { stringify } from "yaml";

const version = process.env.npm_package_version ?? JSON.parse(readFileSync("package.json", "utf8")).version;
const releaseDir = resolve(process.argv[2] ?? "release");
const files = ["x64", "arm64"].map((arch) => {
  const name = `乖乖Ai-${version}-${arch}.zip`;
  const path = resolve(releaseDir, name);
  const contents = readFileSync(path);
  return {
    url: basename(path).replace(/^乖乖/, ""),
    sha512: createHash("sha512").update(contents).digest("base64"),
    size: statSync(path).size,
  };
});

const manifest = {
  version,
  files,
  path: files[0].url,
  sha512: files[0].sha512,
  releaseDate: new Date().toISOString(),
};

writeFileSync(resolve(releaseDir, "latest-mac.yml"), stringify(manifest));
console.log(`Aligned macOS update manifest for ${version}: ${files.map(({ url }) => url).join(", ")}`);
