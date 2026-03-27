import type { PlatformAccessory } from "homebridge";
import type { Bulb, Plug } from "tplink-smarthome-api";
import type { TplinkSmarthomeConfig } from "../config.js";
import type {
  TplinkSmarthomeAccessoryContext,
  TplinkSmarthomePlatform,
} from "../TplinkSmarthomePlatform.js";
import type { TplinkDevice } from "../util/types.js";
import type { HomekitDevice } from "./HomekitDevice.js";
import { HomekitDeviceBulb } from "./HomekitDeviceBulb.js";
import { HomekitDevicePlug } from "./HomekitDevicePlug.js";

/**
 * Factory method to create a HomeKitDeviceBulb or HomeKitDevicePlug.
 *
 * KLAP/AES adapter classes (KlapPlug, KlapBulb) implement the same interface
 * as tplink-smarthome-api's Plug/Bulb but aren't instances of those classes.
 * We cast here since the HomeKit device classes only use the duck-typed interface.
 */
export function createHomekitDevice(
  platform: TplinkSmarthomePlatform,
  config: TplinkSmarthomeConfig,
  homebridgeAccessory: PlatformAccessory<TplinkSmarthomeAccessoryContext> | undefined,
  tplinkDevice: TplinkDevice,
): HomekitDevice {
  if (tplinkDevice.deviceType === "bulb") {
    return new HomekitDeviceBulb(
      platform,
      config,
      homebridgeAccessory,
      tplinkDevice as unknown as Bulb,
    );
  }
  return new HomekitDevicePlug(
    platform,
    config,
    homebridgeAccessory,
    tplinkDevice as unknown as Plug,
  );
}
