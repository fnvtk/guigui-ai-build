import { readFile, mkdir, writeFile, chmod } from "node:fs/promises";
import { join } from "node:path";
import { createPrivateKey, createPublicKey, X509Certificate } from "node:crypto";

/** Called only by the owner after selecting the fixed local merchant folder; no file content is returned. */
export async function importGuaiWechatCredentials(sourceDirectory: string, privateDirectory: string, timeoutMs = 8_000) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error("证书读取超时，请重新选择已授权的微信证书文件夹。")); }, timeoutMs);
  });
  try {
    const [certPem, keyPem] = await Promise.race([
      Promise.all([readFile(join(sourceDirectory, "apiclient_cert.pem"), { signal: controller.signal }), readFile(join(sourceDirectory, "apiclient_key.pem"), { signal: controller.signal })]),
      timeout,
    ]);
    const certificate = new X509Certificate(certPem);
    const privateKey = createPrivateKey(keyPem);
    if (!createPublicKey(privateKey).export({ type: "spki", format: "der" }).equals(certificate.publicKey.export({ type: "spki", format: "der" }))) throw new Error("商户证书和私钥不匹配，未导入。");
    const destination = join(privateDirectory, certificate.fingerprint256.replaceAll(":", ""));
    await mkdir(destination, { recursive: true, mode: 0o700 });
    await chmod(destination, 0o700);
    const merchantCertificatePath = join(destination, "merchant-cert.pem");
    const privateKeyPath = join(destination, "merchant-key.pem");
    await writeFile(merchantCertificatePath, certPem, { mode: 0o600 });
    await writeFile(privateKeyPath, keyPem, { mode: 0o600 });
    await chmod(merchantCertificatePath, 0o600); await chmod(privateKeyPath, 0o600);
    const merchantId = certificate.subject.match(/(?:^|\n)CN\s*=\s*(\d{6,32})(?:\n|$)/)?.[1];
    return { merchantCertificatePath, privateKeyPath, ...(merchantId ? { merchantId } : {}) };
  } finally { clearTimeout(timer!); }
}
