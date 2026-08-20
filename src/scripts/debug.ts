/**
 * Debug REPL for discovering and controlling Kasa devices on the local network.
 * No HomeKit involvement. Uses the same discovery and device control code as the plugin.
 *
 * Usage: pnpm run debug:script
 * Env: KASA_EMAIL, KASA_PASSWORD, KASA_BROADCAST (loaded from .env via --env-file)
 */

import * as readline from "node:readline";
import chalk from "chalk";
import { Client } from "tplink-smarthome-api";
import type { KlapBulb } from "../klap/KlapBulb.js";
import { KlapDiscovery } from "../klap/KlapDiscovery.js";
import type { KlapPlug } from "../klap/KlapPlug.js";
import type { TplinkDevice } from "../util/types.js";

// ---------------------------------------------------------------------------
// Device registry
// ---------------------------------------------------------------------------

interface DeviceEntry {
  num: number;
  device: TplinkDevice;
  protocol: "legacy" | "klap/aes";
}

const devicesById = new Map<string, DeviceEntry>();
let nextNum = 1;

function registerDevice(
  device: TplinkDevice,
  protocol: "legacy" | "klap/aes",
): DeviceEntry {
  const existing = devicesById.get(device.id);
  if (existing) {
    // Update host in case it changed, prefer authenticated HTTP if both are found
    if (protocol === "klap/aes") existing.protocol = protocol;
    return existing;
  }

  const entry: DeviceEntry = { num: nextNum++, device, protocol };
  devicesById.set(device.id, entry);
  return entry;
}

function getEntry(num: number): DeviceEntry | undefined {
  for (const entry of devicesById.values()) {
    if (entry.num === num) return entry;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Logging helpers
// ---------------------------------------------------------------------------

function ts(): string {
  return chalk.dim(new Date().toLocaleTimeString());
}

function logEvent(entry: DeviceEntry, event: string, detail?: string) {
  const tag = chalk.blue(`[${entry.num}:${entry.device.alias}]`);
  const extra = detail ? ` ${detail}` : "";
  console.log(`${ts()} ${tag} ${chalk.yellow(event)}${extra}`);
}

function logDiscovery(msg: string) {
  console.log(`${ts()} ${chalk.magenta("[discovery]")} ${msg}`);
}

// ---------------------------------------------------------------------------
// Wire up device events
// ---------------------------------------------------------------------------

function attachEvents(entry: DeviceEntry) {
  const { device } = entry;

  if (device.deviceType === "plug") {
    device.on("power-update", (v) => logEvent(entry, "power-update", String(v)));
    device.on("in-use-update", (v) => logEvent(entry, "in-use-update", String(v)));
    device.on("emeter-realtime-update", (v) =>
      logEvent(entry, "emeter-realtime-update", JSON.stringify(v)),
    );
  } else {
    device.on("lightstate-update", (v) =>
      logEvent(entry, "lightstate-update", JSON.stringify(v)),
    );
    device.on("emeter-realtime-update", (v) =>
      logEvent(entry, "emeter-realtime-update", JSON.stringify(v)),
    );
  }
}

// ---------------------------------------------------------------------------
// Discovery setup
// ---------------------------------------------------------------------------

const email = process.env.KASA_EMAIL;
const password = process.env.KASA_PASSWORD;
const broadcast = process.env.KASA_BROADCAST;

if (!email || !password) {
  console.error(chalk.red("Missing KASA_EMAIL or KASA_PASSWORD in .env"));
  process.exit(1);
}

if (!broadcast) {
  console.warn(
    chalk.yellow("No KASA_BROADCAST in .env, KLAP/AES/TPAP subnet scanning disabled"),
  );
}

// Legacy XOR discovery (port 9999)
const legacyClient = new Client({ defaultSendOptions: { timeout: 15000 } });

legacyClient.on("device-new", (device: TplinkDevice) => {
  const entry = registerDevice(device, "legacy");
  attachEvents(entry);
  logDiscovery(
    `${chalk.green("NEW")} #${entry.num} ${chalk.bold(device.alias)} ` +
      `(${device.model}) ${device.host} [legacy]`,
  );
});

legacyClient.on("device-online", (device: TplinkDevice) => {
  const entry = devicesById.get(device.id);
  if (entry) logDiscovery(`${chalk.green("ONLINE")} #${entry.num} ${device.alias}`);
});

legacyClient.on("device-offline", (device: TplinkDevice) => {
  const entry = devicesById.get(device.id);
  if (entry) logDiscovery(`${chalk.red("OFFLINE")} #${entry.num} ${device.alias}`);
});

// KLAP/AES/TPAP discovery (port 80)
const klapDiscovery = new KlapDiscovery({
  credentials: { username: email, password },
  broadcast,
  discoveryInterval: 30_000,
  timeout: 10_000,
});

klapDiscovery.on("device-new", (device: KlapPlug | KlapBulb) => {
  const entry = registerDevice(device as TplinkDevice, "klap/aes");
  attachEvents(entry);
  logDiscovery(
    `${chalk.green("NEW")} #${entry.num} ${chalk.bold(device.alias)} ` +
      `(${device.model}) ${device.host} [klap/aes]`,
  );
});

klapDiscovery.on("device-online", (device: KlapPlug | KlapBulb) => {
  const entry = devicesById.get(device.id);
  if (entry)
    logDiscovery(`${chalk.green("ONLINE")} #${entry.num} ${device.alias} [klap/aes]`);
});

klapDiscovery.on("device-offline", (device: KlapPlug | KlapBulb) => {
  const entry = devicesById.get(device.id);
  if (entry)
    logDiscovery(`${chalk.red("OFFLINE")} #${entry.num} ${device.alias} [klap/aes]`);
});

klapDiscovery.on("warning", (msg: string) => {
  console.log(`${ts()} ${chalk.yellow("[klap:warn]")} ${msg}`);
});

klapDiscovery.on("debug", (msg: string) => {
  console.log(`${ts()} ${chalk.dim("[klap:debug]")} ${msg}`);
});

klapDiscovery.on("error", (err: Error) => {
  console.error(`${ts()} ${chalk.red("[klap:error]")} ${err.message}`);
});

// ---------------------------------------------------------------------------
// REPL commands
// ---------------------------------------------------------------------------

function printDeviceList() {
  if (devicesById.size === 0) {
    console.log(chalk.dim("  No devices discovered yet."));
    return;
  }

  const sorted = [...devicesById.values()].sort((a, b) => a.num - b.num);
  for (const { num, device, protocol } of sorted) {
    const state = formatState(device);
    const proto = chalk.dim(`[${protocol}]`);
    console.log(
      `  ${chalk.bold(String(num).padStart(2))}  ${state}  ` +
        `${chalk.blue(device.alias.padEnd(24))} ${device.model.padEnd(12)} ` +
        `${device.host.padEnd(16)} ${proto}`,
    );
  }
}

function formatState(device: TplinkDevice): string {
  if (device.deviceType === "plug") {
    return device.relayState ? chalk.green("ON ") : chalk.red("OFF");
  }
  const ls = device.sysInfo.light_state;
  const on = ls.on_off === 1;
  const brightness = ls.brightness != null ? ` ${ls.brightness}%` : "";
  return on ? chalk.green(`ON${brightness} `) : chalk.red("OFF");
}

async function handleCommand(line: string) {
  const parts = line.trim().split(/\s+/);
  const cmd = parts[0]?.toLowerCase();
  if (!cmd) return;

  const num = Number(parts[1]);
  const entry = num ? getEntry(num) : undefined;

  switch (cmd) {
    case "list":
    case "ls": {
      printDeviceList();
      break;
    }

    case "on":
    case "off": {
      if (!entry) {
        console.log(chalk.red(`Unknown device: ${parts[1]}`));
        break;
      }
      const value = cmd === "on";
      try {
        if (entry.device.deviceType === "plug") {
          await entry.device.setPowerState(value);
        } else {
          await entry.device.lighting.setLightState({ on_off: value ? 1 : 0 });
        }
        console.log(
          `  ${chalk.blue(entry.device.alias)} -> ${value ? chalk.green("ON") : chalk.red("OFF")}`,
        );
      } catch (err) {
        console.error(chalk.red(`  Failed: ${err}`));
      }
      break;
    }

    case "info": {
      if (!entry) {
        console.log(chalk.red(`Unknown device: ${parts[1]}`));
        break;
      }
      try {
        const sysinfo = await entry.device.getSysInfo();
        console.log(`  ${chalk.bold(entry.device.alias)} (${entry.device.model})`);
        console.log(`  Host: ${entry.device.host}:${entry.device.port}`);
        console.log(`  MAC:  ${entry.device.mac}`);
        console.log(`  FW:   ${entry.device.softwareVersion}`);
        console.log(`  HW:   ${entry.device.hardwareVersion}`);
        console.log(`  ID:   ${entry.device.id}`);
        console.log(`  Protocol: ${entry.protocol}`);
        console.log(`  SysInfo: ${JSON.stringify(sysinfo, null, 2)}`);
      } catch (err) {
        console.error(chalk.red(`  Failed: ${err}`));
      }
      break;
    }

    case "emeter": {
      if (!entry) {
        console.log(chalk.red(`Unknown device: ${parts[1]}`));
        break;
      }
      if (!entry.device.supportsEmeter) {
        console.log(
          chalk.dim(`  ${entry.device.alias} does not support energy monitoring`),
        );
        break;
      }
      try {
        const rt = await entry.device.emeter.getRealtime();
        console.log(
          `  ${chalk.bold(entry.device.alias)} emeter:`,
          JSON.stringify(rt, null, 2),
        );
      } catch (err) {
        console.error(chalk.red(`  Failed: ${err}`));
      }
      break;
    }

    case "blink": {
      if (!entry) {
        console.log(chalk.red(`Unknown device: ${parts[1]}`));
        break;
      }
      const times = Number(parts[2]) || 3;
      console.log(`  Blinking ${entry.device.alias} ${times} times...`);
      try {
        await entry.device.blink(times, 800);
        console.log("  Done.");
      } catch (err) {
        console.error(chalk.red(`  Failed: ${err}`));
      }
      break;
    }

    case "help": {
      console.log(`
  ${chalk.bold("Commands:")}
    list / ls          List discovered devices
    on <n>             Turn device on
    off <n>            Turn device off
    info <n>           Show detailed device info
    emeter <n>         Show energy monitoring data
    blink <n> [times]  Blink device (default 3 times)
    help               Show this help
    quit / exit        Exit
`);
      break;
    }

    case "quit":
    case "exit": {
      shutdown();
      break;
    }

    default: {
      console.log(chalk.dim(`  Unknown command: ${cmd}. Type "help" for commands.`));
    }
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

function shutdown() {
  console.log(chalk.dim("\nShutting down..."));
  legacyClient.stopDiscovery();
  klapDiscovery.stop();
  rl.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

console.log(chalk.bold("\nKasa Debug REPL"));
console.log(chalk.dim("Discovering devices on the local network...\n"));

legacyClient.startDiscovery({
  discoveryInterval: 30_000,
  deviceTypes: ["plug", "bulb"],
  filterCallback: (sysinfo) => !!sysinfo.deviceId,
});

klapDiscovery.start();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: chalk.dim("kasa> "),
});

rl.prompt();

rl.on("line", async (line) => {
  await handleCommand(line);
  rl.prompt();
});

rl.on("close", shutdown);
