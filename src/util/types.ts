import type { Bulb, Plug } from "tplink-smarthome-api";

import type { KlapBulb } from "../klap/KlapBulb.js";
import type { KlapPlug } from "../klap/KlapPlug.js";

export type TplinkDevice = Bulb | Plug | KlapPlug | KlapBulb;

export function isObjectLike(candidate: unknown): candidate is Record<string, unknown> {
  return (
    (typeof candidate === "object" && candidate !== null) ||
    typeof candidate === "function"
  );
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
