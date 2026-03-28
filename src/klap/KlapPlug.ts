import { EventEmitter } from "node:events";

import type { PlugLike } from "../util/types.js";
import type { DeviceProtocol } from "./protocol.js";
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

export class KlapPlug extends EventEmitter implements PlugLike {
  private _sysInfo: PlugSysinfoLike;

  private _host: string;

  private _port: number;

  private readonly transport: Transport;

  private readonly protocol: DeviceProtocol;

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
    protocol: DeviceProtocol,
  ) {
    super();
    this._host = host;
    this._port = port;
    this._sysInfo = { ...sysinfo };
    this.transport = transport;
    this.protocol = protocol;

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
    const newInfo = await this.protocol.fetchSysInfo(this.transport);

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
    await this.protocol.sendSetPowerState(this.transport, value);
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
