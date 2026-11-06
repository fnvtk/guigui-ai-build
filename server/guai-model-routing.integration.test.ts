import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, it } from "vitest";
import { OpenAICompatDriver } from "./drivers/openai-compat.ts";

it("routes all three public tiers through the existing credential and endpoint", async () => {
  const requests: Array<{ path: string; authorization?: string; model: string }> = [];
  const server = createServer(async (req, res) => {
    let body = ""; for await (const chunk of req) body += String(chunk);
    requests.push({ path: req.url!, authorization: req.headers.authorization, model: JSON.parse(body).model });
    res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ choices: [{ message: { content: "验证通过" } }] }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const instance = await OpenAICompatDriver.create({ instanceId: "fixture-simpleapi", displayName: "SimpleAPI", enabled: true,
    config: OpenAICompatDriver.decodeConfig({ guaiTiers: true, tools: false, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, apiKeyEnv: "FIXTURE_PRIVATE_KEY" }),
    environment: { FIXTURE_PRIVATE_KEY: "synthetic-existing-key" },
  });
  try {
    expect(instance.models.options.map(model => model.label)).toEqual(["Max", "Pro", "Mini"]);
    await instance.refreshModels?.();
    for (const model of ["kr-mini", "kr-pro", "kr-max"]) expect(await instance.generateText!("仅回复验证通过", { model })).toBe("验证通过");
    expect(requests).toEqual(["gpt-6-luna", "gpt-6.1-terra", "gpt-6-astra"].map(model => ({ path: "/v1/chat/completions", authorization: "Bearer synthetic-existing-key", model })));
    expect(instance.models.options).toHaveLength(3);
  } finally {
    await instance.dispose(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
