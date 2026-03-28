import type { EmeterRealtime, PlugSysinfoLike } from "./types.js";

interface Transport {
  send(request: object): Promise<object>;
}

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

function smartDeviceInfoToPlugSysinfo(info: Record<string, unknown>): PlugSysinfoLike {
  let alias = String(info.nickname ?? info.alias ?? "");
  try {
    if (info.nickname)
      alias = Buffer.from(String(info.nickname), "base64").toString("utf-8");
  } catch {
    /* base64 decode failed, use raw nickname value */
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

export interface DeviceProtocol {
  fetchSysInfo(transport: Transport): Promise<PlugSysinfoLike | undefined>;
  sendSetPowerState(transport: Transport, value: boolean): Promise<void>;
  fetchEmeterRealtime(transport: Transport): Promise<EmeterRealtime | undefined>;
}

export const IotProtocol: DeviceProtocol = {
  async fetchSysInfo(transport) {
    const response = (await transport.send({
      system: { get_sysinfo: {} },
    })) as { system?: { get_sysinfo?: PlugSysinfoLike } };
    return response?.system?.get_sysinfo;
  },

  async sendSetPowerState(transport, value) {
    await transport.send({
      system: { set_relay_state: { state: value ? 1 : 0 } },
    });
  },

  async fetchEmeterRealtime(transport) {
    const response = (await transport.send({
      emeter: { get_realtime: {} },
    })) as { emeter?: { get_realtime?: Record<string, unknown> } };
    const rt = response?.emeter?.get_realtime;
    return rt ? normaliseEmeterRealtime(rt) : undefined;
  },
};

export const SmartProtocol: DeviceProtocol = {
  async fetchSysInfo(transport) {
    const response = (await transport.send({
      method: "get_device_info",
    })) as { result?: Record<string, unknown> };
    return response?.result ? smartDeviceInfoToPlugSysinfo(response.result) : undefined;
  },

  async sendSetPowerState(transport, value) {
    await transport.send({
      method: "set_device_info",
      params: { device_on: value },
    });
  },

  async fetchEmeterRealtime(transport) {
    const response = (await transport.send({
      method: "get_emeter_data",
    })) as { result?: Record<string, unknown> };
    const rt = response?.result;
    return rt && Object.keys(rt).length > 0 ? normaliseEmeterRealtime(rt) : undefined;
  },
};

export function isSmartDevice(typeField?: string): boolean {
  return typeField?.toUpperCase().startsWith("SMART.") === true;
}
