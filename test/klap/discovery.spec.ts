import { HomebridgeAPI } from "homebridge/lib/api";
import { describe, expect, it, vi } from "vitest";

import { KlapDiscovery } from "../../src/klap/KlapDiscovery.js";
import type { DeviceSysinfo } from "../../src/klap/types.js";
import { TplinkSmarthomePlatform } from "../../src/TplinkSmarthomePlatform.js";

type DiscoveryOptions = ConstructorParameters<typeof KlapDiscovery>[0];

function smartPlug(mac: string, deviceId = "PLUG-1"): DeviceSysinfo {
  return {
    deviceId,
    alias: "Plug",
    model: "KP125M",
    mac,
    sw_ver: "1.0.0",
    hw_ver: "1.0",
    type: "SMART.KASAPLUG",
    relay_state: 0,
  };
}

function iotBulb(mac: string): DeviceSysinfo {
  return {
    deviceId: "BULB-1",
    alias: "Bulb",
    model: "KL125(US)",
    mac,
    sw_ver: "1.0.0",
    hw_ver: "1.0",
    mic_type: "IOT.SMARTBULB",
    is_dimmable: 1,
    is_color: 1,
    is_variable_color_temp: 1,
    light_state: { on_off: 0 },
  } as DeviceSysinfo;
}

function register(discovery: KlapDiscovery, sysinfo: DeviceSysinfo) {
  const transport = { send: vi.fn(), close: vi.fn() };
  const found = vi.fn();
  discovery.on("device-new", found);
  discovery.on("device-online", found);
  discovery.on("debug", () => {});
  (discovery as any).registerDevice("192.0.2.10", 80, transport, "klap", sysinfo);
  return { transport, found };
}

function discover(options: Partial<DiscoveryOptions>, sysinfo: DeviceSysinfo) {
  const discovery = new KlapDiscovery({ discoveryInterval: 10_000, ...options });
  return { discovery, ...register(discovery, sysinfo) };
}

describe("KlapDiscovery device filters", () => {
  it("registers a device when no filters are configured", () => {
    const { discovery, found } = discover({}, smartPlug("AA:BB:CC:DD:EE:FF"));

    expect(found).toHaveBeenCalledTimes(1);
    expect(discovery.getDevices().size).toBe(1);
  });

  it.each([
    ["exact", "AA:BB:CC:DD:EE:FF"],
    ["lower case", "aa:bb:cc:dd:ee:ff"],
    ["dash separated", "AA-BB-CC-DD-EE-FF"],
    ["no separators", "AABBCCDDEEFF"],
    ["glob", "AA:BB:CC:*"],
    ["single-character glob", "AA:BB:CC:DD:EE:F?"],
  ])("skips a device matching excludeMacAddresses (%s)", (_name, pattern) => {
    const { discovery, found, transport } = discover(
      { excludeMacAddresses: [pattern] },
      smartPlug("AA:BB:CC:DD:EE:FF"),
    );

    expect(found).not.toHaveBeenCalled();
    expect(discovery.getDevices().size).toBe(0);
    expect(transport.close).toHaveBeenCalledTimes(1);
  });

  it("keeps a device that does not match excludeMacAddresses", () => {
    const { found } = discover(
      { excludeMacAddresses: ["AA:BB:CC:DD:EE:00"] },
      smartPlug("AA:BB:CC:DD:EE:FF"),
    );

    expect(found).toHaveBeenCalledTimes(1);
  });

  it("only registers devices matching macAddresses when it is set", () => {
    const options = { macAddresses: ["AA:BB:CC:DD:EE:FF"] };

    expect(discover(options, smartPlug("AA:BB:CC:DD:EE:FF")).found).toHaveBeenCalled();
    expect(
      discover(options, smartPlug("11:22:33:44:55:66")).found,
    ).not.toHaveBeenCalled();
  });

  it("skips device types missing from deviceTypes", () => {
    const options = { deviceTypes: ["plug" as const] };

    expect(discover(options, smartPlug("AA:BB:CC:DD:EE:FF")).found).toHaveBeenCalled();
    expect(
      discover(options, iotBulb("AA:BB:CC:DD:EE:01")).found,
    ).not.toHaveBeenCalled();
  });

  it("matches bulbs that report their MAC as mic_mac", () => {
    const { mac: _mac, ...rest } = iotBulb("");
    const bulb = { ...rest, mic_mac: "AABBCCDDEE01" } as unknown as DeviceSysinfo;

    expect(
      discover({ excludeMacAddresses: ["AA:BB:CC:DD:EE:01"] }, bulb).found,
    ).not.toHaveBeenCalled();
    expect(
      discover({ macAddresses: ["AA:BB:CC:DD:EE:01"] }, bulb).found,
    ).toHaveBeenCalled();
  });

  it("still registers a different device later found at a filtered host", () => {
    const { discovery } = discover(
      { excludeMacAddresses: ["AA:BB:CC:DD:EE:FF"] },
      smartPlug("AA:BB:CC:DD:EE:FF"),
    );

    const { found } = register(discovery, smartPlug("11:22:33:44:55:66", "PLUG-2"));

    expect(found).toHaveBeenCalledTimes(1);
  });
});

describe("TplinkSmarthomePlatform KLAP discovery", () => {
  it("does not add a KLAP device whose MAC is in excludeMacAddresses", () => {
    const log = Object.assign(() => {}, {
      prefix: "",
      debug: () => {},
      error: () => {},
      info: () => {},
      success: () => {},
      log: () => {},
      warn: () => {},
    });
    const platform = new TplinkSmarthomePlatform(
      log as any,
      {
        platform: "",
        name: "tplink",
        kasaUsername: "user@example.com",
        kasaPassword: "password",
        excludeMacAddresses: ["aa-bb-cc-dd-ee-ff"],
      },
      new HomebridgeAPI(),
    );
    const createHomekitDevice = vi
      .spyOn(platform as any, "createHomekitDevice")
      .mockReturnValue({});

    register(platform["klapDiscovery"]!, smartPlug("AA:BB:CC:DD:EE:FF"));
    expect(createHomekitDevice).not.toHaveBeenCalled();
    expect(platform["homekitDevicesById"].size).toBe(0);

    register(platform["klapDiscovery"]!, smartPlug("11:22:33:44:55:66", "PLUG-2"));
    expect(createHomekitDevice).toHaveBeenCalledTimes(1);
  });
});
