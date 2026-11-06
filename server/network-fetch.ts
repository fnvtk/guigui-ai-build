import { EnvHttpProxyAgent, fetch as undiciFetch } from "undici";

const originalFetch = globalThis.fetch;
const proxyConfigured = Boolean(
  process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy
    || process.env.ALL_PROXY || process.env.all_proxy,
);
const dispatcher = proxyConfigured ? new EnvHttpProxyAgent() : undefined;

/** Uses the host's proxy for upstream HTTPS while keeping test and fixture fetch stubs intact. */
export function networkFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  const currentFetch = globalThis.fetch;
  if (currentFetch !== originalFetch) return currentFetch(input, init);
  if (!dispatcher) return currentFetch(input, init);
  return undiciFetch(input, { ...init, dispatcher });
}
