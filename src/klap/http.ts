import * as http from "node:http";

export type HttpHeaders = Record<string, string | string[] | undefined>;

export interface HttpResponse {
  statusCode: number;
  headers: HttpHeaders;
  body: Buffer;
}

/**
 * HTTP POST using Node's built-in http module.
 *
 * Each request creates a fresh TCP connection (no keep-alive pooling).
 * TP-Link's SHIP HTTP parser is case-sensitive and rejects requests
 * with lowercase `content-length` (as sent by undici), so we use
 * node:http which sends standard-cased headers.
 */
export function httpPost(
  url: string,
  body: Buffer | string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const reqBody = typeof body === "string" ? Buffer.from(body, "utf-8") : body;

    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || 80,
        path: parsed.pathname + parsed.search,
        method: "POST",
        headers: {
          ...headers,
          "Content-Length": String(reqBody.length),
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers as HttpHeaders,
            body: Buffer.concat(chunks),
          });
        });
        res.on("error", reject);
      },
    );

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy(new Error(`HTTP request timed out after ${timeoutMs}ms`));
    });

    req.write(reqBody);
    req.end();
  });
}
