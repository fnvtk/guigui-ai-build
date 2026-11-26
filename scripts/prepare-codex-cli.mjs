import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import * as tar from "tar";

const root = resolve(import.meta.dirname, "..");
const version = process.env.CODEX_CLI_VERSION || "0.172.0";
const requestedPlatform = process.argv[process.argv.indexOf("--platform") + 1];
const targetPlatform = requestedPlatform || process.env.CODEX_CLI_PLATFORM || process.platform;
const output = join(root, "dist-native", "codex");
const staging = mkdtempSync(join(tmpdir(), "openmausbot-codex-"));

const packageTargets = targetPlatform === "darwin"
  ? [
      ["arm64", "darwin-arm64", "aarch64-apple-darwin"],
      ["x64", "darwin-x64", "x86_64-apple-darwin"],
    ]
  : targetPlatform === "win32"
    ? [["x64", "win32-x64", "x86_64-pc-windows-msvc"]]
    : [["x64", "linux-x64", "x86_64-unknown-linux-musl"]];

function pack(spec) {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const archive = execFileSync(npm, ["pack", "--silent", "--pack-destination", staging, spec], {
    cwd: root,
    encoding: "utf8",
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "inherit"],
  }).trim().split(/\r?\n/).at(-1);
  if (!archive) throw new Error(`npm pack returned no archive for ${spec}`);
  return join(staging, archive);
}

async function unpack(archive, target) {
  const extracted = mkdtempSync(join(staging, "extract-"));
  await tar.x({ file: archive, cwd: extracted });
  const packageRoot = join(extracted, "package");
  if (!existsSync(packageRoot)) throw new Error(`Codex archive has no package directory: ${archive}`);
  mkdirSync(target, { recursive: true });
  cpSync(packageRoot, target, { recursive: true });
}

rmSync(output, { recursive: true, force: true });

for (const [arch, platformPackage, triple] of packageTargets) {
  const slice = join(output, arch);
  const rootPackage = join(slice, "node_modules", "@openai", "codex");
  await unpack(pack(`@openai/codex@${version}`), rootPackage);
  const packageRoot = join(slice, "node_modules", "@openai", `codex-${platformPackage}`);
  await unpack(pack(`@openai/codex@${version}-${platformPackage}`), packageRoot);
  const executable = join(packageRoot, "vendor", triple, "bin", targetPlatform === "win32" ? "codex.exe" : "codex");
  if (!existsSync(executable)) throw new Error(`Codex ${platformPackage} archive has no expected executable`);

  const bin = join(slice, "bin");
  mkdirSync(bin, { recursive: true });
  if (targetPlatform === "win32") {
    writeFileSync(join(bin, "codex.cmd"), `@echo off\r\nset "CODEX_MANAGED_PACKAGE_ROOT=%~dp0..\\node_modules\\@openai\\codex"\r\n"%~dp0..\\node_modules\\@openai\\codex-${platformPackage}\\vendor\\${triple}\\bin\\codex.exe" %*\r\n`);
  } else {
    const script = `#!/bin/sh\nset -eu\nROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)\nexport CODEX_MANAGED_PACKAGE_ROOT="$ROOT/node_modules/@openai/codex"\nexec "$ROOT/node_modules/@openai/codex-${platformPackage}/vendor/${triple}/bin/codex" "$@"\n`;
    const launcher = join(bin, "codex");
    writeFileSync(launcher, script);
    chmodSync(launcher, 0o755);
  }
}

const manifest = {
  name: "@openai/codex",
  version,
  targets: packageTargets.map(([arch, platformPackage]) => ({ arch, package: platformPackage })),
};
writeFileSync(join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Prepared bundled Codex CLI ${version}: ${manifest.targets.map(({ arch }) => arch).join(", ")}`);
