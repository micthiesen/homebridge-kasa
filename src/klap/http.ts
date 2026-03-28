import { Agent, request } from "undici";

const CONNECT_TIMEOUT_MS = 3_000;

const agent = new Agent({
  connect: { timeout: CONNECT_TIMEOUT_MS },
  keepAliveTimeout: 30_000,
  keepAliveMaxTimeout: 60_000,
  pipelining: 1,
});

export function closeHttpAgent(): void {
  if (agent.closed || agent.destroyed) return;
  agent.close(() => {});
}

export type HttpHeaders = Record<string, string | string[] | undefined>;

export interface HttpResponse {
  statusCode: number;
  headers: HttpHeaders;
  body: Buffer;
}

/**
 * Derive granular timeouts from an overall timeout budget.
 *
 * - headersTimeout: 60% of overall (time to receive response headers after request sent)
 * - bodyTimeout: 80% of overall (max time between body data chunks)
 *
 * The overall timeout is still enforced as a hard deadline via AbortSignal.
 */
function deriveTimeouts(overallMs: number) {
  return {
    headersTimeout: Math.round(overallMs * 0.6),
    bodyTimeout: Math.round(overallMs * 0.8),
  };
}

/**
 * HTTP POST using undici with connection pooling and granular timeouts.
 *
 * Connections to the same origin are reused via keep-alive. Connect timeout
 * is fixed at 3s (suitable for local network IoT devices). Per-request
 * headers and body timeouts are derived from the caller's overall timeout.
 */
export async function httpPost(
  url: string,
  body: Buffer | string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<HttpResponse> {
  const reqBody = typeof body === "string" ? Buffer.from(body, "utf-8") : body;
  const { headersTimeout, bodyTimeout } = deriveTimeouts(timeoutMs);

  const resp = await request(url, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Length": String(reqBody.length),
    },
    body: reqBody,
    dispatcher: agent,
    headersTimeout,
    bodyTimeout,
    signal: AbortSignal.timeout(timeoutMs),
  });

  const chunks: Buffer[] = [];
  for await (const chunk of resp.body) {
    chunks.push(Buffer.from(chunk));
  }

  return {
    statusCode: resp.statusCode,
    headers: resp.headers as HttpHeaders,
    body: Buffer.concat(chunks),
  };
}
