import type { HttpHeaders } from "./http.js";

/**
 * Parse TP_SESSIONID from Set-Cookie header(s).
 *
 * The device may return one or more Set-Cookie values. We look for
 * TP_SESSIONID or SESSIONID and return the raw cookie string suitable
 * for sending back in a Cookie header.
 */
export function parseSessionCookie(headers: HttpHeaders): string | undefined {
  const raw = headers["set-cookie"];
  if (!raw) return undefined;

  const cookies = Array.isArray(raw) ? raw : [raw];
  for (const cookie of cookies) {
    const match = cookie.match(/(?:TP_SESSIONID|SESSIONID)=([^;]+)/i);
    if (match) {
      return `TP_SESSIONID=${match[1]}`;
    }
  }
  return undefined;
}

/**
 * Parse the TIMEOUT value from Set-Cookie headers (seconds).
 */
export function parseTimeoutCookie(headers: HttpHeaders): number | undefined {
  const raw = headers["set-cookie"];
  if (!raw) return undefined;

  const cookies = Array.isArray(raw) ? raw : [raw];
  for (const cookie of cookies) {
    const match = cookie.match(/TIMEOUT=(\d+)/i);
    if (match) {
      return parseInt(match[1], 10);
    }
  }
  return undefined;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}
