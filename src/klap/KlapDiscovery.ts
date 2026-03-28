/**
 * Device discovery for KLAP v2 and AES protocol TP-Link Kasa devices.
 *
 * Discovers devices on port 80 by attempting KLAP/AES handshakes,
 * then creates adapter instances compatible with the existing HomeKit
 * device layer.
 */

import * as crypto from "node:crypto";
import { EventEmitter } from "node:events";
import * as net from "node:net";
import { tryCatch, withTimeout } from "@micthiesen/mitools/async";

import { AesTransport } from "./AesTransport.js";
import { httpPost } from "./http.js";
import { KlapBulb } from "./KlapBulb.js";
import { KlapPlug } from "./KlapPlug.js";
import { KlapTransport } from "./KlapTransport.js";
import { IotProtocol, isSmartDevice, SmartProtocol } from "./protocol.js";
import type {
  BulbSysinfoLike,
  DeviceSysinfo,
  KasaCredentials,
  PlugSysinfoLike,
  TransportType,
} from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type KlapDevice = KlapPlug | KlapBulb;

interface DeviceRecord {
  device: KlapDevice;
  transport: KlapTransport | AesTransport;
  protocol: TransportType;
  online: boolean;
}

interface DiscoveryOptions {
  credentials?: KasaCredentials;
  devices?: Array<{ host: string; port?: number }>;
  broadcast?: string;
  discoveryInterval: number;
  timeout?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT = 5_000;
const TCP_PROBE_TIMEOUT = 2_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Quick TCP connect check to see if a port is open.
 */
function isPortOpen(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();

    const cleanup = () => {
      socket.removeAllListeners();
      socket.destroy();
    };

    socket.setTimeout(timeoutMs);

    socket.on("connect", () => {
      cleanup();
      resolve(true);
    });

    socket.on("timeout", () => {
      cleanup();
      resolve(false);
    });

    socket.on("error", () => {
      cleanup();
      resolve(false);
    });

    socket.connect(port, host);
  });
}

/**
 * Derive /24 subnet IPs from a broadcast address (e.g. '10.10.1.255').
 * Returns the 254 usable host IPs (.1 through .254).
 */
function subnetIpsFromBroadcast(broadcast: string): string[] {
  const parts = broadcast.split(".");
  if (parts.length !== 4) return [];

  const prefix = parts.slice(0, 3).join(".");
  const ips: string[] = [];
  for (let i = 1; i <= 254; i += 1) {
    ips.push(`${prefix}.${i}`);
  }
  return ips;
}

/**
 * Detect which protocol a device on port 80 speaks: KLAP v2 or AES.
 * Returns the detected protocol type, or null if neither responds.
 */
async function detectProtocol(
  host: string,
  port: number,
  timeoutMs: number,
): Promise<TransportType | null> {
  // Try KLAP handshake1 first (POST /app/handshake1 with 16 random bytes)
  try {
    const seed = crypto.randomBytes(16);
    const resp = await httpPost(
      `http://${host}:${port}/app/handshake1`,
      seed,
      { "Content-Type": "application/octet-stream" },
      timeoutMs,
    );
    if (resp.statusCode === 200) {
      return "klap";
    }
  } catch {
    // Connection failed or timed out, try AES next
  }

  // Try AES handshake (POST /app with JSON handshake)
  try {
    const resp = await httpPost(
      `http://${host}:${port}/app`,
      JSON.stringify({ method: "handshake", params: { key: "" } }),
      { "Content-Type": "application/json" },
      timeoutMs,
    );
    if (resp.statusCode === 200) {
      try {
        const result = JSON.parse(resp.body.toString("utf-8"));
        // AES devices respond with error_code (even if non-zero, it means the
        // endpoint exists and speaks the AES protocol)
        if (result.error_code !== undefined) {
          return "aes";
        }
      } catch {
        // Not JSON, not an AES device
      }
    }
  } catch {
    // Connection failed or timed out
  }

  return null;
}

/**
 * Determine device type from sysinfo's type or mic_type field.
 */
function classifyDevice(sysinfo: DeviceSysinfo): "plug" | "bulb" | null {
  const typeStr = (sysinfo.type ?? sysinfo.mic_type ?? "").toUpperCase();
  if (typeStr.includes("SMARTPLUGSWITCH")) return "plug";
  if (typeStr.includes("KASAPLUG")) return "plug"; // SMART.KASAPLUG
  if (typeStr.includes("KASASWITCH")) return "plug"; // SMART.KASASWITCH
  if (typeStr.includes("SMARTBULB")) return "bulb";
  if (typeStr.includes("KASABULB")) return "bulb"; // SMART.KASABULB
  return null;
}

/**
 * Translate a SMART protocol get_device_info response into DeviceSysinfo.
 */
function smartInfoToSysinfo(info: Record<string, unknown>): DeviceSysinfo {
  let alias = String(info.nickname ?? info.alias ?? "");
  try {
    if (info.nickname)
      alias = Buffer.from(String(info.nickname), "base64").toString("utf-8");
  } catch {
    /* use raw value */
  }

  return {
    deviceId: String(info.device_id ?? ""),
    alias,
    model: String(info.model ?? ""),
    mac: String(info.mac ?? "").replace(/-/g, ":"),
    sw_ver: String(info.fw_ver ?? ""),
    hw_ver: String(info.hw_ver ?? ""),
    type: String(info.type ?? ""),
    relay_state: info.device_on === true ? 1 : 0,
  };
}

// ---------------------------------------------------------------------------
// KlapDiscovery
// ---------------------------------------------------------------------------

export class KlapDiscovery extends EventEmitter {
  private readonly credentials: KasaCredentials | undefined;
  private readonly explicitDevices: Array<{ host: string; port: number }>;
  private readonly broadcast: string | undefined;
  private readonly discoveryInterval: number;
  private readonly timeout: number;

  private readonly knownDevices: Map<string, DeviceRecord> = new Map();
  private intervalTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(options: DiscoveryOptions) {
    super();
    this.credentials = options.credentials;
    this.explicitDevices = (options.devices ?? []).map((d) => ({
      host: d.host,
      port: d.port ?? 80,
    }));
    this.broadcast = options.broadcast;
    this.discoveryInterval = options.discoveryInterval;
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT;
  }

  /**
   * Begin periodic discovery. Runs an initial probe immediately, then
   * repeats every `discoveryInterval` ms.
   */
  start(): void {
    if (this.running) return;
    this.running = true;

    // Run immediately, then on interval
    void this.runDiscoveryCycle();
    this.intervalTimer = setInterval(() => {
      void this.runDiscoveryCycle();
    }, this.discoveryInterval);
  }

  /**
   * Stop discovery and close all transport sessions.
   */
  stop(): void {
    this.running = false;

    if (this.intervalTimer != null) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }

    for (const record of this.knownDevices.values()) {
      record.transport.close();
    }
  }

  /**
   * Returns the map of currently known devices keyed by device ID.
   */
  getDevices(): Map<string, KlapDevice> {
    const result = new Map<string, KlapDevice>();
    for (const [id, record] of this.knownDevices) {
      result.set(id, record.device);
    }
    return result;
  }

  // -----------------------------------------------------------------------
  // Discovery cycle
  // -----------------------------------------------------------------------

  private discoveryInProgress = false;

  private async runDiscoveryCycle(): Promise<void> {
    // Prevent overlapping cycles
    if (this.discoveryInProgress) return;
    this.discoveryInProgress = true;

    try {
      // 1. Check existing devices are still online
      await this.checkExistingDevices();

      // 2. Build candidate list
      const candidates = await this.buildCandidateList();

      // 3. Probe each candidate (with concurrency limit and per-probe timeout)
      const CONCURRENCY = 10;
      const PROBE_TIMEOUT = this.timeout * 4;
      for (let i = 0; i < candidates.length; i += CONCURRENCY) {
        const batch = candidates.slice(i, i + CONCURRENCY);
        await Promise.allSettled(
          batch.map((c) =>
            withTimeout(this.probeCandidate(c.host, c.port), PROBE_TIMEOUT),
          ),
        );
      }
    } catch (err) {
      this.emit("error", err);
    } finally {
      this.discoveryInProgress = false;
    }
  }

  /**
   * Check all known devices by sending getSysInfo. If a device fails to
   * respond, mark it offline and emit 'device-offline'.
   */
  private async checkExistingDevices(): Promise<void> {
    const checks = Array.from(this.knownDevices.entries()).map(
      async ([_id, record]) => {
        try {
          await record.device.getSysInfo();
          if (!record.online) {
            record.online = true;
            this.emit("device-online", record.device);
          }
        } catch {
          if (record.online) {
            record.online = false;
            this.emit("device-offline", record.device);
          }
        }
      },
    );

    await Promise.allSettled(checks);
  }

  /**
   * Build the list of IPs to probe. Combines explicit device list with
   * optional subnet scanning.
   */
  private async buildCandidateList(): Promise<Array<{ host: string; port: number }>> {
    // Collect all known hosts so we can skip them
    const knownHosts = new Set<string>();
    for (const record of this.knownDevices.values()) {
      if (record.online) {
        knownHosts.add(record.device.host);
      }
    }

    const candidates: Array<{ host: string; port: number }> = [];

    // Add explicit devices that are not already known and online
    for (const d of this.explicitDevices) {
      if (!knownHosts.has(d.host)) {
        candidates.push(d);
      }
    }

    // Subnet scan if broadcast address is provided
    if (this.broadcast) {
      const subnetIps = subnetIpsFromBroadcast(this.broadcast);
      const unknownIps = subnetIps.filter((ip) => {
        // Skip IPs that are already known+online or already in explicit list
        if (knownHosts.has(ip)) return false;
        if (candidates.some((c) => c.host === ip)) return false;
        return true;
      });

      // TCP probe for open port 80 with concurrency limit
      const SCAN_CONCURRENCY = 50;
      for (let i = 0; i < unknownIps.length; i += SCAN_CONCURRENCY) {
        const batch = unknownIps.slice(i, i + SCAN_CONCURRENCY);
        const results = await Promise.allSettled(
          batch.map(async (ip) => {
            const open = await isPortOpen(ip, 80, TCP_PROBE_TIMEOUT);
            return { ip, open };
          }),
        );

        for (const result of results) {
          if (result.status === "fulfilled" && result.value.open) {
            candidates.push({ host: result.value.ip, port: 80 });
          }
        }
      }
    }

    return candidates;
  }

  /**
   * Probe a single candidate IP:
   * 1. Detect protocol (KLAP or AES)
   * 2. Create transport and complete handshake
   * 3. Fetch sysinfo to identify the device
   * 4. Create adapter and emit events
   */
  private async probeCandidate(host: string, port: number): Promise<void> {
    // Skip if already known and online
    for (const record of this.knownDevices.values()) {
      if (record.device.host === host && record.online) {
        return;
      }
    }

    const result = await this.establishTransport(host, port);
    if (result == null) return;

    const { transport, protocol } = result;

    const sysinfo = await this.fetchSysinfo(transport);
    if (!sysinfo) {
      transport.close();
      return;
    }

    this.registerDevice(host, port, transport, protocol, sysinfo);
  }

  /**
   * Detect which protocol the device speaks, create the appropriate
   * transport, and complete the handshake. Returns null if the device
   * does not respond to either protocol.
   */
  private async establishTransport(
    host: string,
    port: number,
  ): Promise<{
    transport: KlapTransport | AesTransport;
    protocol: TransportType;
  } | null> {
    const protocol = await detectProtocol(host, port, this.timeout);
    if (protocol == null) return null;

    const transport =
      protocol === "klap"
        ? new KlapTransport({
            host,
            port,
            credentials: this.credentials,
            timeout: this.timeout,
          })
        : new AesTransport({
            host,
            port,
            credentials: this.credentials,
            timeout: this.timeout,
          });

    try {
      await transport.handshake();
    } catch {
      transport.close();
      return null;
    }

    return { transport, protocol };
  }

  /**
   * Fetch device sysinfo by trying the legacy IOT protocol first,
   * then falling back to the SMART protocol.
   */
  private async fetchSysinfo(
    transport: KlapTransport | AesTransport,
  ): Promise<DeviceSysinfo | undefined> {
    // Try legacy IOT: system.get_sysinfo
    const iotResult = await tryCatch(async () => {
      const response = (await transport.send({
        system: { get_sysinfo: {} },
      })) as { system?: { get_sysinfo?: DeviceSysinfo } };
      return response?.system?.get_sysinfo;
    });
    if (iotResult.ok && iotResult.value?.deviceId) return iotResult.value;

    // Fall back to SMART protocol: get_device_info
    const smartResult = await tryCatch(async () => {
      const response = (await transport.send({
        method: "get_device_info",
      })) as { result?: Record<string, unknown> };
      if (response?.result && (response.result.device_id || response.result.deviceId)) {
        return smartInfoToSysinfo(response.result);
      }
      return undefined;
    });
    if (smartResult.ok && smartResult.value) return smartResult.value;

    return undefined;
  }

  /**
   * Classify the device, then either update an existing record or create
   * a new adapter and emit discovery events.
   */
  private registerDevice(
    host: string,
    port: number,
    transport: KlapTransport | AesTransport,
    protocol: TransportType,
    sysinfo: DeviceSysinfo,
  ): void {
    const deviceClass = classifyDevice(sysinfo);
    if (deviceClass == null) {
      this.emit(
        "error",
        new Error(
          `Unrecognized device type '${sysinfo.type ?? sysinfo.mic_type}' ` +
            `for ${sysinfo.alias} (${sysinfo.model}) at ${host}`,
        ),
      );
      transport.close();
      return;
    }

    // Check if this device was previously known (by device ID)
    const existingRecord = this.knownDevices.get(sysinfo.deviceId);
    if (existingRecord != null) {
      existingRecord.transport.close();
      existingRecord.transport = transport;
      existingRecord.protocol = protocol;
      existingRecord.device.host = host;
      existingRecord.device.port = port;
      existingRecord.online = true;
      this.emit("device-online", existingRecord.device);
      return;
    }

    // Create new adapter
    const deviceProtocol = isSmartDevice(sysinfo.type) ? SmartProtocol : IotProtocol;
    let device: KlapDevice;
    if (deviceClass === "plug") {
      device = new KlapPlug(
        host,
        port,
        sysinfo as PlugSysinfoLike,
        transport,
        deviceProtocol,
      );
    } else {
      device = new KlapBulb(
        host,
        port,
        sysinfo as BulbSysinfoLike,
        transport,
        deviceProtocol,
      );
    }

    this.knownDevices.set(sysinfo.deviceId, {
      device,
      transport,
      protocol,
      online: true,
    });

    this.emit("device-new", device);
  }
}
