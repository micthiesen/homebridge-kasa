import type { PlatformAccessory } from "homebridge";
import type { Bulb, Plug } from "tplink-smarthome-api";
import type { TplinkSmarthomeConfig } from "../config.js";
import type TplinkSmarthomePlatform from "../platform.js";
import type { TplinkSmarthomeAccessoryContext } from "../platform.js";
import type { TplinkDevice } from "../utils.js";
import HomeKitDeviceBulb from "./bulb.js";
import type HomekitDevice from "./index.js";
import HomeKitDevicePlug from "./plug.js";

/**
 * Factory method to create a HomeKitDeviceBulb or HomeKitDevicePlug.
 *
 * KLAP/AES adapter classes (KlapPlug, KlapBulb) implement the same interface
 * as tplink-smarthome-api's Plug/Bulb but aren't instances of those classes.
 * We cast here since the HomeKit device classes only use the duck-typed interface.
 */
export default function create(
  platform: TplinkSmarthomePlatform,
  config: TplinkSmarthomeConfig,
  homebridgeAccessory: PlatformAccessory<TplinkSmarthomeAccessoryContext> | undefined,
  tplinkDevice: TplinkDevice,
): HomekitDevice {
  if (tplinkDevice.deviceType === "bulb") {
    return new HomeKitDeviceBulb(
      platform,
      config,
      homebridgeAccessory,
      tplinkDevice as unknown as Bulb,
    );
  }
  return new HomeKitDevicePlug(
    platform,
    config,
    homebridgeAccessory,
    tplinkDevice as unknown as Plug,
  );
}
