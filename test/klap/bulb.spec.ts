import { describe, expect, it, vi } from "vitest";

import { KlapBulb } from "../../src/klap/KlapBulb.js";
import { IotProtocol } from "../../src/klap/protocol.js";
import type { BulbSysinfoLike } from "../../src/klap/types.js";

const STRIP_MODULE = "smartlife.iot.lightStrip";
const BULB_MODULE = "smartlife.iot.smartbulb.lightingservice";

function sysinfo(overrides: Partial<BulbSysinfoLike>): BulbSysinfoLike {
  return {
    deviceId: "0000000000000000000000000000000000000000",
    alias: "Test",
    model: "KL125(US)",
    mac: "00:00:00:00:00:00",
    sw_ver: "1.0.0",
    hw_ver: "1.0",
    mic_type: "IOT.SMARTBULB",
    is_dimmable: 1,
    is_color: 1,
    is_variable_color_temp: 1,
    light_state: { on_off: 0 },
    ...overrides,
  };
}

function createBulb(info: BulbSysinfoLike, response: object) {
  const send = vi.fn(async (_request: object) => response);
  const bulb = new KlapBulb("192.0.2.1", 80, info, { send }, IotProtocol, "tpap");
  return { bulb, send };
}

describe("KlapBulb", () => {
  describe("light strip", () => {
    const strip = sysinfo({ model: "KL420L5(US)", length: 16 });

    it("sends light state through the light strip module", async () => {
      const { bulb, send } = createBulb(strip, {
        [STRIP_MODULE]: { set_light_state: { err_code: 0, on_off: 1 } },
      });

      await bulb.lighting.setLightState({ on_off: 1 });

      expect(send).toHaveBeenCalledWith({
        [STRIP_MODULE]: { set_light_state: { ignore_default: 1, on_off: 1 } },
      });
      expect(bulb.sysInfo.light_state.on_off).toBe(1);
    });

    it("falls back to a default color temperature range for unlisted models", () => {
      const { bulb } = createBulb(strip, {});

      expect(bulb.supportsColorTemperature).toBe(true);
      expect(bulb.colorTemperatureRange).toEqual({ min: 2700, max: 6500 });
    });
  });

  it("sends light state through the bulb module for bulbs", async () => {
    const { bulb, send } = createBulb(sysinfo({}), {
      [BULB_MODULE]: { transition_light_state: { err_code: 0, on_off: 1 } },
    });

    await bulb.lighting.setLightState({ on_off: 1 });

    expect(send).toHaveBeenCalledWith({
      [BULB_MODULE]: { transition_light_state: { on_off: 1 } },
    });
  });

  it("has no color temperature range when the device lacks the capability", () => {
    const { bulb } = createBulb(
      sysinfo({ model: "KL50(US)", is_variable_color_temp: 0 }),
      {},
    );

    expect(bulb.supportsColorTemperature).toBe(false);
    expect(bulb.colorTemperatureRange).toBeNull();
  });

  it.each([
    ["module", { [BULB_MODULE]: { err_code: -1, err_msg: "module not support" } }],
    [
      "method",
      {
        [BULB_MODULE]: {
          transition_light_state: { err_code: -3, err_msg: "invalid argument" },
        },
      },
    ],
  ])(
    "rejects and keeps cached state when the device reports a %s error",
    async (_level, response) => {
      const { bulb } = createBulb(sysinfo({}), response);

      await expect(bulb.lighting.setLightState({ on_off: 1 })).rejects.toThrow(
        /rejected by device: err_code=-/,
      );
      expect(bulb.sysInfo.light_state.on_off).toBe(0);
    },
  );
});
