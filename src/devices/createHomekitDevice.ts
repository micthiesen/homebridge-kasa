import type { PlatformAccessory } from "homebridge";
import type { TplinkSmarthomeConfig } from "../config.js";
import type {
  TplinkSmarthomeAccessoryContext,
  TplinkSmarthomePlatform,
} from "../TplinkSmarthomePlatform.js";
import type { TplinkDevice } from "../util/types.js";
import type { HomekitDevice } from "./HomekitDevice.js";
import { HomekitDeviceBulb } from "./HomekitDeviceBulb.js";
import { HomekitDevicePlug } from "./HomekitDevicePlug.js";

export function createHomekitDevice(
  platform: TplinkSmarthomePlatform,
  config: TplinkSmarthomeConfig,
  homebridgeAccessory: PlatformAccessory<TplinkSmarthomeAccessoryContext> | undefined,
  tplinkDevice: TplinkDevice,
): HomekitDevice {
  if (tplinkDevice.deviceType === "bulb") {
    return new HomekitDeviceBulb(platform, config, homebridgeAccessory, tplinkDevice);
  }
  return new HomekitDevicePlug(platform, config, homebridgeAccessory, tplinkDevice);
}
