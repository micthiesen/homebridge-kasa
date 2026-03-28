import { EventEmitter } from "node:events";
import type { BulbLike } from "../util/types.js";
import { delay } from "../util/types.js";
import { modelSupportsEmeter } from "./emeter.js";
import type { DeviceProtocol } from "./protocol.js";
import type { BulbSysinfoLike, EmeterRealtime, LightStateLike } from "./types.js";

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

export class KlapBulb extends EventEmitter implements BulbLike {
  private _sysInfo: BulbSysinfoLike;

  private _host: string;

  private _port: number;

  private readonly transport: Transport;

  private readonly protocol: DeviceProtocol;

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
  ) {
    super();
    this._host = host;
    this._port = port;
    this._sysInfo = { ...sysinfo, light_state: { ...sysinfo.light_state } };
    this.transport = transport;
    this.protocol = protocol;

    // -- lighting sub-object --
    this.lighting = {
      setLightState: async (state: Partial<LightStateLike>): Promise<true> => {
        await this.transport.send({
          "smartlife.iot.smartbulb.lightingservice": {
            transition_light_state: state,
          },
        });
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
    return getColorTempRange(this._sysInfo.model);
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
      await delay(rate / 2);
      await this.lighting.setLightState({ on_off: origOnOff });
      await delay(rate / 2);
    }
    return true;
  }
}
