import { EventEmitter } from "node:events";

import type { EmeterRealtime, PlugSysinfoLike } from "./types.js";

interface Transport {
  send(request: object): Promise<object>;
}

const EMETER_MODELS = ["HS110", "HS300", "KP115", "KP125", "EP25"];

function modelSupportsEmeter(model: string): boolean {
  return EMETER_MODELS.some((m) => model.toUpperCase().includes(m));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Detect if a device uses the SMART protocol (e.g. KP125M, Tapo-style)
 * vs the legacy IOT protocol (e.g. HS103, HS110).
 */
function isSmartDevice(typeField?: string): boolean {
  return typeField?.toUpperCase().startsWith("SMART.") === true;
}

/**
 * Translate a SMART protocol get_device_info response into the
 * PlugSysinfoLike shape expected by the HomeKit device classes.
 */
function smartDeviceInfoToPlugSysinfo(info: Record<string, unknown>): PlugSysinfoLike {
  // nickname is base64 encoded in SMART protocol
  let alias = String(info.nickname ?? info.alias ?? "");
  try {
    if (info.nickname)
      alias = Buffer.from(String(info.nickname), "base64").toString("utf-8");
  } catch {
    /* use raw value */
  }

  return {
    deviceId: String(info.device_id ?? info.deviceId ?? ""),
    alias,
    model: String(info.model ?? ""),
    mac: String(info.mac ?? "").replace(/-/g, ":"),
    sw_ver: String(info.fw_ver ?? info.sw_ver ?? ""),
    hw_ver: String(info.hw_ver ?? ""),
    type: String(info.type ?? ""),
    relay_state: info.device_on === true ? 1 : 0,
  };
}

/**
 * Normalise an emeter realtime response.
 * Some devices return values in milli-units (current_ma, power_mw, voltage_mv, total_wh).
 */
function normaliseEmeterRealtime(rt: Record<string, unknown>): EmeterRealtime {
  const num = (key: string): number | undefined => {
    const v = rt[key];
    return typeof v === "number" ? v : undefined;
  };

  return {
    current:
      num("current") ??
      (num("current_ma") != null ? num("current_ma")! / 1000 : undefined),
    power:
      num("power") ?? (num("power_mw") != null ? num("power_mw")! / 1000 : undefined),
    voltage:
      num("voltage") ??
      (num("voltage_mv") != null ? num("voltage_mv")! / 1000 : undefined),
    total:
      num("total") ?? (num("total_wh") != null ? num("total_wh")! / 1000 : undefined),
  };
}

export class KlapPlug extends EventEmitter {
  private _sysInfo: PlugSysinfoLike;

  private _host: string;

  private _port: number;

  private readonly transport: Transport;

  private readonly _isSmart: boolean;

  readonly dimmer: {
    brightness: number;
    setBrightness: (value: number) => Promise<unknown>;
  };

  readonly emeter: {
    realtime: EmeterRealtime;
    getRealtime: () => Promise<unknown>;
  };

  constructor(
    host: string,
    port: number,
    sysinfo: PlugSysinfoLike,
    transport: Transport,
  ) {
    super();
    this._host = host;
    this._port = port;
    this._sysInfo = { ...sysinfo };
    this.transport = transport;
    this._isSmart = isSmartDevice(sysinfo.type);

    // -- dimmer sub-object --
    const self = this;
    this.dimmer = {
      get brightness(): number {
        return self._sysInfo.brightness ?? 0;
      },
      setBrightness: async (value: number): Promise<unknown> => {
        const response = await this.transport.send({
          "smartlife.iot.dimmer": { set_brightness: { brightness: value } },
        });
        this._sysInfo.brightness = value;
        return response;
      },
    };

    // -- emeter sub-object --
    const emeterRealtime: EmeterRealtime = {};
    this.emeter = {
      realtime: emeterRealtime,
      getRealtime: async (): Promise<unknown> => {
        if (this._isSmart) {
          // SMART protocol: get_emeter_data returns milli-units directly
          const response = (await this.transport.send({
            method: "get_emeter_data",
          })) as { result?: Record<string, unknown> };

          const rt = response?.result;
          if (rt) {
            Object.assign(this.emeter.realtime, normaliseEmeterRealtime(rt));
          }
        } else {
          // Legacy IOT protocol
          const response = (await this.transport.send({
            emeter: { get_realtime: {} },
          })) as { emeter?: { get_realtime?: EmeterRealtime } };

          const rt = response?.emeter?.get_realtime;
          if (rt) {
            Object.assign(
              this.emeter.realtime,
              normaliseEmeterRealtime(rt as Record<string, unknown>),
            );
          }
        }

        this.emit("emeter-realtime-update", this.emeter.realtime);
        return this.emeter.realtime;
      },
    };
  }

  // -- Identity properties --

  get id(): string {
    return this._sysInfo.deviceId;
  }

  get alias(): string {
    return this._sysInfo.alias;
  }

  get model(): string {
    return this._sysInfo.model;
  }

  get mac(): string {
    return this._sysInfo.mac;
  }

  get softwareVersion(): string {
    return this._sysInfo.sw_ver;
  }

  get hardwareVersion(): string {
    return this._sysInfo.hw_ver;
  }

  get deviceType(): "plug" {
    return "plug";
  }

  get host(): string {
    return this._host;
  }

  set host(value: string) {
    this._host = value;
  }

  get port(): number {
    return this._port;
  }

  set port(value: number) {
    this._port = value;
  }

  // -- State properties --

  get relayState(): boolean {
    return this._sysInfo.relay_state === 1;
  }

  get inUse(): boolean {
    if (this.supportsEmeter) {
      const power = this.emeter.realtime.power;
      if (power != null) {
        return power > 0;
      }
    }
    return this.relayState;
  }

  get supportsDimmer(): boolean {
    return this._sysInfo.brightness != null;
  }

  get supportsEmeter(): boolean {
    return modelSupportsEmeter(this._sysInfo.model);
  }

  get sysInfo(): PlugSysinfoLike {
    return this._sysInfo;
  }

  // -- Methods --

  async getSysInfo(): Promise<PlugSysinfoLike> {
    let newInfo: PlugSysinfoLike | undefined;

    if (this._isSmart) {
      // SMART protocol: get_device_info
      const response = (await this.transport.send({
        method: "get_device_info",
      })) as { result?: Record<string, unknown> };

      if (response?.result) {
        newInfo = smartDeviceInfoToPlugSysinfo(response.result);
      }
    } else {
      // Legacy IOT protocol
      const response = (await this.transport.send({
        system: { get_sysinfo: {} },
      })) as { system?: { get_sysinfo?: PlugSysinfoLike } };

      newInfo = response?.system?.get_sysinfo;
    }

    if (newInfo) {
      const oldRelayState = this._sysInfo.relay_state;
      const oldInUse = this.inUse;
      const oldBrightness = this._sysInfo.brightness;

      this._sysInfo = { ...this._sysInfo, ...newInfo };

      // Emit events by diffing
      if (this._sysInfo.relay_state !== oldRelayState) {
        this.emit("power-update", this.relayState);
      }
      if (this.inUse !== oldInUse) {
        this.emit("in-use-update", this.inUse);
      }
      if (
        this._sysInfo.brightness != null &&
        this._sysInfo.brightness !== oldBrightness
      ) {
        this.emit("brightness-update", this._sysInfo.brightness);
      }
    }

    return this._sysInfo;
  }

  async setPowerState(value: boolean): Promise<true> {
    if (this._isSmart) {
      await this.transport.send({
        method: "set_device_info",
        params: { device_on: value },
      });
    } else {
      await this.transport.send({
        system: { set_relay_state: { state: value ? 1 : 0 } },
      });
    }
    this._sysInfo.relay_state = value ? 1 : 0;
    return true;
  }

  async blink(times = 5, rate = 1000): Promise<boolean> {
    const origState = this.relayState;
    for (let i = 0; i < times; i += 1) {
      await this.setPowerState(!origState);
      await delay(rate / 2);
      await this.setPowerState(origState);
      await delay(rate / 2);
    }
    return true;
  }
}
