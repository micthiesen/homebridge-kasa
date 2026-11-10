import { EventEmitter } from "node:events";
import { sleep } from "@micthiesen/mitools/async";
import type { BulbLike } from "../util/types.js";
import { modelSupportsEmeter } from "./emeter.js";
import type { DeviceProtocol } from "./protocol.js";
import type {
  BulbSysinfoLike,
  EmeterRealtime,
  LightStateLike,
  TransportType,
} from "./types.js";

interface Transport {
  send(request: object): Promise<object>;
}

// Color temperature ranges by model (Kelvin). Extend as needed.
const COLOR_TEMP_RANGES: Record<string, { min: number; max: number }> = {
  LB120: { min: 2700, max: 6500 },
  LB130: { min: 2500, max: 9000 },
  LB230: { min: 2500, max: 9000 },
  KL120: { min: 2700, max: 5000 },
  KL125: { min: 2500, max: 6500 },
  KL130: { min: 2500, max: 9000 },
  KL135: { min: 2500, max: 6500 },
  KL430: { min: 2500, max: 9000 },
};

function getColorTempRange(model: string): { min: number; max: number } | null {
  for (const [prefix, range] of Object.entries(COLOR_TEMP_RANGES)) {
    if (model.toUpperCase().includes(prefix)) {
      return range;
    }
  }
  return null;
}

// Matches tplink-smarthome-api's default for models missing from the table.
const DEFAULT_COLOR_TEMP_RANGE = { min: 2700, max: 6500 };

// Light strips report their LED segment count as `length`, and only answer
// lighting commands on their own module.
function isLightStrip(sysinfo: BulbSysinfoLike): boolean {
  return (sysinfo.length ?? 0) > 0;
}

/**
 * Devices answer a rejected command with HTTP 200 and an `err_code` on the
 * module or the method, so without this check a failed command looks sent.
 */
function assertCommandAccepted(
  response: unknown,
  module: string,
  method: string,
): void {
  const moduleResponse = (response as Record<string, unknown> | null)?.[module] as
    | Record<string, unknown>
    | undefined;
  const methodResponse = moduleResponse?.[method] as
    | Record<string, unknown>
    | undefined;
  for (const candidate of [moduleResponse, methodResponse]) {
    const errCode = candidate?.err_code;
    if (typeof errCode === "number" && errCode !== 0) {
      const errMsg = candidate?.err_msg;
      throw new Error(
        `${module}.${method} rejected by device: err_code=${errCode}` +
          (typeof errMsg === "string" ? ` (${errMsg})` : ""),
      );
    }
  }
}

export class KlapBulb extends EventEmitter implements BulbLike {
  private _sysInfo: BulbSysinfoLike;

  private _host: string;

  private _port: number;

  private readonly transport: Transport;

  private readonly protocol: DeviceProtocol;

  readonly transportType: TransportType;

  readonly lighting: {
    setLightState: (state: Partial<LightStateLike>) => Promise<true>;
  };

  readonly emeter: {
    realtime: EmeterRealtime;
    getRealtime: () => Promise<unknown>;
  };

  constructor(
    host: string,
    port: number,
    sysinfo: BulbSysinfoLike,
    transport: Transport,
    protocol: DeviceProtocol,
    transportType: TransportType,
  ) {
    super();
    this._host = host;
    this._port = port;
    this._sysInfo = { ...sysinfo, light_state: { ...sysinfo.light_state } };
    this.transport = transport;
    this.protocol = protocol;
    this.transportType = transportType;

    // -- lighting sub-object --
    this.lighting = {
      setLightState: async (state: Partial<LightStateLike>): Promise<true> => {
        const strip = isLightStrip(this._sysInfo);
        const module = strip
          ? "smartlife.iot.lightStrip"
          : "smartlife.iot.smartbulb.lightingservice";
        const method = strip ? "set_light_state" : "transition_light_state";
        const response = await this.transport.send({
          // ignore_default matches what tplink-smarthome-api sends to strips.
          [module]: { [method]: strip ? { ignore_default: 1, ...state } : state },
        });
        assertCommandAccepted(response, module, method);
        // Merge into cached light_state
        const ls = this._sysInfo.light_state;
        if (state.on_off != null) ls.on_off = state.on_off;
        if (state.brightness != null) ls.brightness = state.brightness;
        if (state.color_temp != null) ls.color_temp = state.color_temp;
        if (state.hue != null) ls.hue = state.hue;
        if (state.saturation != null) ls.saturation = state.saturation;
        return true;
      },
    };

    // -- emeter sub-object --
    const emeterRealtime: EmeterRealtime = {};
    this.emeter = {
      realtime: emeterRealtime,
      getRealtime: async (): Promise<unknown> => {
        const rt = await this.protocol.fetchEmeterRealtime(this.transport);
        if (rt) {
          Object.assign(this.emeter.realtime, rt);
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

  get deviceType(): "bulb" {
    return "bulb";
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

  // -- Capability properties --

  get supportsBrightness(): boolean {
    return (
      this._sysInfo.is_dimmable === 1 || this._sysInfo.light_state.brightness != null
    );
  }

  get supportsColor(): boolean {
    return this._sysInfo.is_color === 1 || this._sysInfo.light_state.hue != null;
  }

  get supportsColorTemperature(): boolean {
    return (
      this._sysInfo.is_variable_color_temp === 1 || this.colorTemperatureRange != null
    );
  }

  get colorTemperatureRange(): { min: number; max: number } | null {
    const range = getColorTempRange(this._sysInfo.model);
    if (range != null) return range;
    return this._sysInfo.is_variable_color_temp === 1 ? DEFAULT_COLOR_TEMP_RANGE : null;
  }

  get supportsEmeter(): boolean {
    return modelSupportsEmeter(this._sysInfo.model);
  }

  // -- State --

  get sysInfo(): BulbSysinfoLike {
    return this._sysInfo;
  }

  // -- Methods --

  async getSysInfo(): Promise<BulbSysinfoLike> {
    const response = (await this.transport.send({
      system: { get_sysinfo: {} },
    })) as { system?: { get_sysinfo?: BulbSysinfoLike } };

    const newInfo = response?.system?.get_sysinfo;
    if (newInfo) {
      const oldLightState = { ...this._sysInfo.light_state };

      this._sysInfo = {
        ...this._sysInfo,
        ...newInfo,
        light_state: { ...this._sysInfo.light_state, ...newInfo.light_state },
      };

      const newLightState = this._sysInfo.light_state;

      // Emit on/off events
      if (newLightState.on_off !== oldLightState.on_off) {
        if (newLightState.on_off === 1) {
          this.emit("lightstate-on");
          this.emit("lightstate-sysinfo-on");
        } else {
          this.emit("lightstate-off");
          this.emit("lightstate-sysinfo-off");
        }
      }

      // Emit update events (always, so listeners can react to any change)
      this.emit("lightstate-update", newLightState);
      this.emit("lightstate-sysinfo-update", newLightState);
    }

    return this._sysInfo;
  }

  async blink(times = 5, rate = 1000): Promise<boolean> {
    const origOnOff = this._sysInfo.light_state.on_off;
    for (let i = 0; i < times; i += 1) {
      await this.lighting.setLightState({
        on_off: origOnOff === 1 ? 0 : 1,
      });
      await sleep(rate / 2);
      await this.lighting.setLightState({ on_off: origOnOff });
      await sleep(rate / 2);
    }
    return true;
  }
}
