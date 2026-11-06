import { randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { join, resolve } from "node:path";

export interface GuaiBillingLocalModuleOptions {
  enabled: boolean;
  moduleDirectory: string;
  privateDirectory: string;
  appId: string;
  tenantId: string;
  catalog: Record<string, unknown>[];
  pythonExecutable?: string;
  startupTimeoutMs?: number;
  fetch?: typeof fetch;
  readModuleFile?: (path: string, signal: AbortSignal) => Promise<string>;
}

export interface GuaiBillingLocalModuleConnection {
  apiUrl: string;
  apiToken: string;
  catalogPath: "/v1/catalog";
  balancePath: "/v1/accounts/{customerId}/balance";
  statusPath: "/v1/orders/{orderId}";
  returnTargetId: string;
  referenceSource: typeof GUAI_BILLING_REFERENCE_SOURCE;
}

export interface VerifiedPaymentGrant {
  customerId: string;
  credits: number;
  transactionId: string;
  kind: string;
  expiresAt?: string;
}

export interface VerifiedPaymentGrantResult {
  lotId: string;
  reused: boolean;
}

export const GUAI_BILLING_REFERENCE_SOURCE = {
  file: "开发文档/8、部署/工具调用修复_20261103/会员价格参考_20261103.json",
  url: "https://kr-ai.quwanzhi.com/console/membership",
  checkedAt: "2026-11-03T14:39:06.387Z",
  scope: "只读价格，不创建订单、不付款",
} as const;

/** Local OpenMausBot product references. The host must preserve referenceOnly and disable checkout for all entries. */
export const GUAI_BILLING_REFERENCE_CATALOG: Record<string, unknown>[] = [
  { skuId: "guai-ai-standard-monthly", priceVersionId: "guai-ai-reference-20261103-standard-v1", name: "普通版", currency: "CNY", amountMinor: 1980, includedCredits: 2000, kind: "subscription", displayPrice: "¥19.8 / 月", referenceOnly: true },
  { skuId: "guai-ai-pro-monthly", priceVersionId: "guai-ai-reference-20261103-pro-v1", name: "专业版", currency: "CNY", amountMinor: 19800, includedCredits: 8000, kind: "subscription", displayPrice: "¥198 / 月", referenceOnly: true },
  { skuId: "guai-ai-super-monthly", priceVersionId: "guai-ai-reference-20261103-super-v1", name: "超级版", currency: "CNY", amountMinor: 198000, includedCredits: 50000, kind: "subscription", displayPrice: "¥1980 / 月", referenceOnly: true },
];

export type GuaiBillingLocalModuleState = "stopped" | "starting" | "ready" | "failed";

export class GuaiBillingLocalModuleError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}

async function freeLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new GuaiBillingLocalModuleError("LOCAL_MODULE_PORT_FAILED", "无法分配本机回环端口");
  const port = address.port;
  await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  return port;
}

function sleep(ms: number): Promise<void> { return new Promise((resolveSleep) => setTimeout(resolveSleep, ms)); }

async function withinDeadline<T>(work: (signal: AbortSignal) => Promise<T>, deadline: number, code: string, message: string): Promise<T> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new GuaiBillingLocalModuleError(code, message);
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new GuaiBillingLocalModuleError(code, message));
      controller.abort();
    }, remaining);
  });
  try { return await Promise.race([work(controller.signal), timeout]); }
  finally { if (timer) clearTimeout(timer); }
}

async function writePrivateFile(path: string, content: string, signal: AbortSignal): Promise<void> {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  let temporaryExists = true;
  try {
    await writeFile(temporaryPath, content, { mode: 0o600, signal, flag: "wx" });
    const handle = await open(temporaryPath, "r+");
    await handle.sync();
    await handle.close();
    await rename(temporaryPath, path);
    temporaryExists = false;
    await chmod(path, 0o600);
  } finally {
    if (temporaryExists) await unlink(temporaryPath).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
  }
}

function validCatalog(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const root = value as Record<string, unknown>;
  if (root.ok !== true || !root.data || typeof root.data !== "object" || Array.isArray(root.data)) return false;
  const data = root.data as Record<string, unknown>;
  return Array.isArray(data.items) && typeof data.paymentChannelsLiveVerified === "boolean";
}

/** Owns one private local Python service child. Credentials exist only in memory and the child's environment. */
export class GuaiBillingLocalModule {
  private readonly options: GuaiBillingLocalModuleOptions;
  private stateValue: GuaiBillingLocalModuleState = "stopped";
  private child: ChildProcess | null = null;
  private connectionValue: GuaiBillingLocalModuleConnection | null = null;
  private startPromise: Promise<GuaiBillingLocalModuleConnection> | null = null;
  private processEnded: Promise<{ code: number | null; error?: Error }> | null = null;
  private closing = false;
  private failureValue: string | null = null;

  constructor(options: GuaiBillingLocalModuleOptions) { this.options = options; }

  get state(): GuaiBillingLocalModuleState { return this.stateValue; }
  get failure(): string | null { return this.failureValue; }
  get connection(): GuaiBillingLocalModuleConnection | null { return this.stateValue === "ready" ? this.connectionValue : null; }

  start(): Promise<GuaiBillingLocalModuleConnection> {
    if (!this.options.enabled) return Promise.reject(new GuaiBillingLocalModuleError("LOCAL_MODULE_DISABLED", "本地收费模块尚未启用"));
    if (this.stateValue === "ready" && this.connectionValue) return Promise.resolve(this.connectionValue);
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.launch().catch(async (error) => {
      if (this.child) await this.close();
      this.stateValue = "failed";
      this.failureValue = error instanceof Error ? error.message : "本地收费模块启动失败";
      throw error;
    }).finally(() => { this.startPromise = null; });
    return this.startPromise;
  }

  async close(): Promise<void> {
    const child = this.child;
    if (!child) {
      this.stateValue = "stopped";
      this.connectionValue = null;
      return;
    }
    this.closing = true;
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    const ended = this.processEnded;
    if (ended) {
      const result = await Promise.race([ended, sleep(2_000).then(() => null)]);
      if (result === null && child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await ended;
      }
    }
    this.child = null;
    this.processEnded = null;
    this.connectionValue = null;
    this.stateValue = "stopped";
    this.closing = false;
  }

  async grantVerifiedPayment(payment: VerifiedPaymentGrant, signal?: AbortSignal): Promise<VerifiedPaymentGrantResult> {
    if (this.stateValue !== "ready") throw new GuaiBillingLocalModuleError("LOCAL_MODULE_NOT_READY", "本地额度核心未就绪");
    if (!payment || typeof payment.customerId !== "string" || !payment.customerId || payment.customerId.length > 240 ||
      !Number.isSafeInteger(payment.credits) || payment.credits <= 0 || typeof payment.transactionId !== "string" || !/^\d{1,32}$/.test(payment.transactionId) ||
      typeof payment.kind !== "string" || !payment.kind ||
      (payment.expiresAt !== undefined && (typeof payment.expiresAt !== "string" || !Number.isFinite(Date.parse(payment.expiresAt)))) ||
      (payment.kind === "subscription" && !payment.expiresAt)) {
      throw new GuaiBillingLocalModuleError("VERIFIED_GRANT_INVALID", "已验证支付记录不完整，未发放额度");
    }
    if (signal?.aborted) throw new GuaiBillingLocalModuleError("VERIFIED_GRANT_ABORTED", "本机额度发放已取消");
    const moduleDirectory = resolve(this.options.moduleDirectory);
    const databasePath = join(resolve(this.options.privateDirectory), "billing-core.sqlite");
    const source = payment.kind === "subscription" ? "included" : "purchased";
    const grantProgram = `import json,sys\nsys.path.insert(0,sys.argv[1])\nfrom core import BillingCore\ndata=json.load(sys.stdin)\nresult=BillingCore(data['database']).grant_verified(data['app'],data['tenant'],data['customer'],data['credits'],data['source'],data['sourceId'],data.get('expiresAt'))\nprint(json.dumps(result,separators=(',',':')))`;
    const child = spawn(this.options.pythonExecutable ?? "python3", ["-c", grantProgram, moduleDirectory], {
      cwd: moduleDirectory,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin", PYTHONNOUSERSITE: "1", PYTHONDONTWRITEBYTECODE: "1", PYTHONUNBUFFERED: "1" },
    });
    const grantPromise = new Promise<VerifiedPaymentGrantResult>((resolveGrant, rejectGrant) => {
      let output = "";
      let finished = false;
      let timer: NodeJS.Timeout;
      const finish = (error?: Error, result?: VerifiedPaymentGrantResult) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        if (error) rejectGrant(error);
        else resolveGrant(result!);
      };
      const abort = () => {
        child.kill("SIGTERM");
        finish(new GuaiBillingLocalModuleError("VERIFIED_GRANT_ABORTED", "本机额度发放已取消"));
      };
      timer = setTimeout(() => {
        child.kill("SIGTERM");
        finish(new GuaiBillingLocalModuleError("VERIFIED_GRANT_TIMEOUT", "本机额度发放超时，请使用原支付订单重试"));
      }, 8_000);
      signal?.addEventListener("abort", abort, { once: true });
      child.stdout?.setEncoding("utf8");
      child.stdout?.on("data", (chunk: string) => {
        output += chunk;
        if (output.length > 8_192) {
          child.kill("SIGTERM");
          finish(new GuaiBillingLocalModuleError("VERIFIED_GRANT_INVALID_RESPONSE", "本机额度核心返回数据过长"));
        }
      });
      child.stderr?.resume();
      child.once("error", () => finish(new GuaiBillingLocalModuleError("VERIFIED_GRANT_FAILED", "本机额度核心调用失败")));
      child.once("close", (code) => {
        if (finished) return;
        if (code !== 0) {
          finish(new GuaiBillingLocalModuleError("VERIFIED_GRANT_FAILED", "本机额度发放失败，请使用原支付订单重试"));
          return;
        }
        try {
          const result = JSON.parse(output) as Partial<VerifiedPaymentGrantResult>;
          if (typeof result.lotId !== "string" || typeof result.reused !== "boolean") throw new Error("invalid grant response");
          finish(undefined, { lotId: result.lotId, reused: result.reused });
        } catch {
          finish(new GuaiBillingLocalModuleError("VERIFIED_GRANT_INVALID_RESPONSE", "本机额度核心返回了无法识别的数据"));
        }
      });
      child.stdin?.end(JSON.stringify({
        database: databasePath,
        app: this.options.appId,
        tenant: this.options.tenantId,
        customer: payment.customerId,
        credits: payment.credits,
        source,
        sourceId: payment.transactionId,
        expiresAt: payment.expiresAt ?? null,
      }));
    });
    return grantPromise;
  }

  private async launch(): Promise<GuaiBillingLocalModuleConnection> {
    this.stateValue = "starting";
    this.failureValue = null;
    const deadline = Date.now() + (this.options.startupTimeoutMs ?? 6_000);
    const moduleDirectory = resolve(this.options.moduleDirectory);
    const runtimeDirectory = resolve(this.options.privateDirectory);
    const servicePath = join(moduleDirectory, "service.py");
    const configPath = join(runtimeDirectory, "config.private.json");
    const databasePath = join(runtimeDirectory, "billing-core.sqlite");
    if (!this.options.appId || !this.options.tenantId || !this.options.catalog.every((item) => item && typeof item === "object" && !Array.isArray(item))) {
      this.stateValue = "failed";
      this.failureValue = "本地收费模块配置无效";
      throw new GuaiBillingLocalModuleError("LOCAL_MODULE_CONFIG_INVALID", this.failureValue);
    }
    try {
      const readModuleFile = this.options.readModuleFile ?? ((path, signal) => readFile(path, { encoding: "utf8", signal }));
      const [serviceSource, coreSource] = await withinDeadline(
        (signal) => Promise.all([readModuleFile(servicePath, signal), readModuleFile(join(moduleDirectory, "core.py"), signal)]),
        deadline,
        "LOCAL_MODULE_PREP_TIMEOUT",
        "读取本地收费模块超时，请检查 macOS 文件夹访问授权",
      );
      if (!serviceSource.trim() || !coreSource.trim()) throw new GuaiBillingLocalModuleError("LOCAL_MODULE_FILES_MISSING", "本地收费模块文件为空");
    } catch (error) {
      this.stateValue = "failed";
      if (error instanceof GuaiBillingLocalModuleError) this.failureValue = error.message;
      else if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") this.failureValue = "找不到本地收费模块文件";
      else this.failureValue = "无法读取本地收费模块，请检查 macOS 文件夹访问授权";
      const code = error instanceof GuaiBillingLocalModuleError ? error.code : this.failureValue === "找不到本地收费模块文件" ? "LOCAL_MODULE_FILES_MISSING" : "LOCAL_MODULE_FILES_UNREADABLE";
      throw new GuaiBillingLocalModuleError(code, this.failureValue);
    }
    try {
      await withinDeadline(async () => {
        await mkdir(runtimeDirectory, { recursive: true, mode: 0o700 });
        await chmod(runtimeDirectory, 0o700);
      }, deadline, "LOCAL_MODULE_PREP_TIMEOUT", "准备本地收费模块私有目录超时");
    } catch (error) {
      this.stateValue = "failed";
      this.failureValue = error instanceof Error ? error.message : "准备本地收费模块私有目录失败";
      throw error;
    }
    const token = randomBytes(32).toString("base64url");
    const tokenEnv = "OMB_LOCAL_BILLING_SERVICE_TOKEN";
    const config = {
      applications: [{ appId: this.options.appId, tenantId: this.options.tenantId, tokenEnv, scopes: ["catalog:read", "balance:read", "checkout:create"] }],
      catalog: this.options.catalog,
    };
    try {
      await withinDeadline((signal) => writePrivateFile(configPath, `${JSON.stringify(config)}\n`, signal), deadline, "LOCAL_MODULE_PREP_TIMEOUT", "写入本地收费模块配置超时");
      await withinDeadline(async () => {
        const database = await open(databasePath, "a", 0o600);
        await database.close();
        await chmod(databasePath, 0o600);
      }, deadline, "LOCAL_MODULE_PREP_TIMEOUT", "准备本地收费模块数据库超时");
    } catch (error) {
      this.stateValue = "failed";
      this.failureValue = error instanceof Error ? error.message : "准备本地收费模块数据失败";
      throw error;
    }
    const port = await withinDeadline(() => freeLoopbackPort(), deadline, "LOCAL_MODULE_PREP_TIMEOUT", "分配本机收费模块端口超时");
    const child = spawn(this.options.pythonExecutable ?? "python3", [servicePath, "--config", configPath, "--database", databasePath, "--transport", "http", "--port", String(port)], {
      cwd: moduleDirectory,
      shell: false,
      stdio: "ignore",
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin", [tokenEnv]: token, PYTHONNOUSERSITE: "1", PYTHONDONTWRITEBYTECODE: "1", PYTHONUNBUFFERED: "1" },
    });
    this.child = child;
    this.closing = false;
    this.processEnded = new Promise((resolveEnd) => {
      child.once("error", (error) => {
        if (!this.closing) { this.stateValue = "failed"; this.failureValue = "本地收费模块进程启动失败"; }
        resolveEnd({ code: null, error });
      });
      child.once("exit", (code) => {
        if (!this.closing) {
          this.stateValue = "failed";
          this.failureValue = `本地收费模块已退出（代码 ${code ?? "signal"}）`;
          this.connectionValue = null;
        }
        resolveEnd({ code });
      });
    });
    const baseUrl = `http://127.0.0.1:${port}`;
    const doFetch = this.options.fetch ?? fetch;
    while (Date.now() < deadline) {
      const ended = this.processEnded;
      if (ended) {
        const exit = await Promise.race([ended, sleep(0).then(() => null)]);
        if (exit) {
          this.stateValue = "failed";
          this.failureValue = exit.error ? "本地收费模块启动失败：Python无法启动" : `本地收费模块已退出（代码 ${exit.code ?? "signal"}）`;
          throw new GuaiBillingLocalModuleError("LOCAL_MODULE_START_FAILED", this.failureValue);
        }
      }
      try {
        const response = await doFetch(`${baseUrl}/v1/catalog`, { headers: { authorization: `Bearer ${token}`, accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(800) });
        const body: unknown = await response.json();
        if (response.ok && validCatalog(body)) {
          if (child.exitCode !== null || child.signalCode !== null || this.failureValue !== null) throw new GuaiBillingLocalModuleError("LOCAL_MODULE_START_FAILED", this.failureValue ?? "本地收费模块已退出");
          const connection = { apiUrl: baseUrl, apiToken: token, catalogPath: "/v1/catalog" as const, balancePath: "/v1/accounts/{customerId}/balance" as const, statusPath: "/v1/orders/{orderId}" as const, returnTargetId: "local-module-no-payment", referenceSource: GUAI_BILLING_REFERENCE_SOURCE };
          this.connectionValue = connection;
          this.stateValue = "ready";
          return connection;
        }
        if (response.status !== 503) throw new GuaiBillingLocalModuleError("LOCAL_MODULE_HEALTH_INVALID", "本地收费模块目录接口返回结构无效");
      } catch (error) {
        if (error instanceof GuaiBillingLocalModuleError) throw error;
      }
      await sleep(100);
    }
    this.stateValue = "failed";
    this.failureValue = "本地收费模块启动超时";
    const failure = new GuaiBillingLocalModuleError("LOCAL_MODULE_START_TIMEOUT", this.failureValue);
    await this.close();
    this.stateValue = "failed";
    this.failureValue = failure.message;
    throw failure;
  }
}
