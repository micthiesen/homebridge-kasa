/**
 * Shared types for the KLAP/AES transport module.
 */

// -- Credentials --

export interface KasaCredentials {
  username: string;
  password: string;
}

// -- Transport --

export type TransportType = "klap" | "aes";

// -- Session state --

export interface KlapSessionState {
  cookie: string;
  encryptionKey: Buffer;
  decryptionKey: Buffer;
  sequenceNumber: number;
  expiry: number;
}

export interface AesSessionState {
  cookie: string;
  key: Buffer;
  iv: Buffer;
  token: string;
  expiry: number;
}

// -- Device sysinfo --

export interface DeviceSysinfo {
  deviceId: string;
  alias: string;
  model: string;
  mac: string;
  sw_ver: string;
  hw_ver: string;
  type?: string;
  mic_type?: string;
  relay_state?: 0 | 1;
  feature?: string;
  dev_name?: string;
  latitude_i?: number;
  longitude_i?: number;
  rssi?: number;
}

export interface PlugSysinfoLike extends DeviceSysinfo {
  relay_state: 0 | 1;
  brightness?: number;
}

export interface BulbSysinfoLike extends DeviceSysinfo {
  light_state: LightStateLike;
  is_dimmable?: 0 | 1;
  is_color?: 0 | 1;
  is_variable_color_temp?: 0 | 1;
}

// -- Light state --

export interface LightStateLike {
  on_off: 0 | 1;
  brightness?: number;
  color_temp?: number;
  hue?: number;
  saturation?: number;
  dft_on_state?: {
    brightness?: number;
    color_temp?: number;
    hue?: number;
    saturation?: number;
  };
}

// -- Energy monitoring --

export interface EmeterRealtime {
  current?: number;
  power?: number;
  voltage?: number;
  total?: number;
}

// -- Discovery --

export interface DeviceDiscoveryInfo {
  host: string;
  port: number;
  protocol: TransportType;
  sysinfo: DeviceSysinfo;
}
