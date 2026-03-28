import type { EmeterRealtime, LightStateLike } from "../klap/types.js";

export interface TplinkDeviceLike {
  id: string;
  alias: string;
  model: string;
  mac: string;
  softwareVersion: string;
  hardwareVersion: string;
  host: string;
  port: number;
  deviceType: "plug" | "bulb" | "device";
  supportsEmeter: boolean;
  emeter: {
    realtime: EmeterRealtime;
    getRealtime: () => Promise<unknown>;
  };
}

export interface PlugLike extends TplinkDeviceLike {
  deviceType: "plug";
  relayState: boolean;
  inUse: boolean;
  supportsDimmer: boolean;
  supportsEmeter: boolean;
  dimmer: {
    brightness: number;
    setBrightness: (value: number) => Promise<unknown>;
  };
  emeter: {
    realtime: EmeterRealtime;
    getRealtime: () => Promise<unknown>;
  };
  getSysInfo(): Promise<unknown>;
  setPowerState(value: boolean): Promise<true>;
  blink(times?: number, rate?: number): Promise<boolean>;
  on(event: "power-update", listener: (value: boolean) => void): this;
  on(event: "in-use-update", listener: (value: boolean) => void): this;
  on(event: "brightness-update", listener: (value: number) => void): this;
  on(event: "emeter-realtime-update", listener: (value: EmeterRealtime) => void): this;
  on(event: string, listener: (...args: unknown[]) => void): this;
}

interface BulbSysinfoShape {
  light_state: LightStateLike;
}

export interface BulbLike extends TplinkDeviceLike {
  deviceType: "bulb";
  supportsBrightness: boolean;
  supportsColor: boolean;
  supportsColorTemperature: boolean;
  supportsEmeter: boolean;
  colorTemperatureRange: { min: number; max: number } | null;
  sysInfo: BulbSysinfoShape;
  lighting: {
    setLightState: (state: Partial<LightStateLike>) => Promise<true>;
  };
  emeter: {
    realtime: EmeterRealtime;
    getRealtime: () => Promise<unknown>;
  };
  getSysInfo(): Promise<BulbSysinfoShape>;
  blink(times?: number, rate?: number): Promise<boolean>;
  on(event: "lightstate-on", listener: () => void): this;
  on(event: "lightstate-off", listener: () => void): this;
  on(event: "lightstate-sysinfo-on", listener: () => void): this;
  on(event: "lightstate-sysinfo-off", listener: () => void): this;
  on(event: "lightstate-update", listener: (value: LightStateLike) => void): this;
  on(
    event: "lightstate-sysinfo-update",
    listener: (value: LightStateLike) => void,
  ): this;
  on(event: "emeter-realtime-update", listener: (value: EmeterRealtime) => void): this;
  on(event: string, listener: (...args: unknown[]) => void): this;
}

export type TplinkDevice = PlugLike | BulbLike;

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
