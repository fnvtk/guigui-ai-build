import { mkdtemp, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { importGuaiWechatCredentials } from "./guai-wechat-import.ts";

describe("local merchant certificate import", () => {
  it("copies a matching fixture to private files without changing the source", async () => {
    const root = await mkdtemp(join(tmpdir(), "guai-import-"));
    try {
      execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(root, "apiclient_key.pem"), "-out", join(root, "apiclient_cert.pem"), "-days", "1", "-subj", "/CN=1234567890"], { stdio: "ignore" });
      const originalMode = (await stat(join(root, "apiclient_key.pem"))).mode;
      const result = await importGuaiWechatCredentials(root, join(root, "private"));
      expect(result.merchantId).toBe("1234567890");
      expect((await stat(result.privateKeyPath)).mode & 0o777).toBe(0o600);
      expect((await stat(result.merchantCertificatePath)).mode & 0o777).toBe(0o600);
      expect((await stat(join(root, "apiclient_key.pem"))).mode).toBe(originalMode);
      expect(await readFile(result.privateKeyPath)).toEqual(await readFile(join(root, "apiclient_key.pem")));
      expect(Object.keys(result).sort()).toEqual(["merchantCertificatePath", "merchantId", "privateKeyPath"]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
