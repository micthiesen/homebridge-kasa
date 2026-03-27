import type { PlatformAccessory } from 'homebridge';
import type { Bulb, Plug } from 'tplink-smarthome-api';

import type TplinkSmarthomePlatform from '../platform';
import type { TplinkSmarthomeAccessoryContext } from '../platform';
import type { TplinkDevice } from '../utils';

import HomekitDevice from '.';
import HomeKitDeviceBulb from './bulb';
import HomeKitDevicePlug from './plug';
import { TplinkSmarthomeConfig } from '../config';

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
  homebridgeAccessory:
    | PlatformAccessory<TplinkSmarthomeAccessoryContext>
    | undefined,
  tplinkDevice: TplinkDevice
): HomekitDevice {
  if (tplinkDevice.deviceType === 'bulb') {
    return new HomeKitDeviceBulb(
      platform,
      config,
      homebridgeAccessory,
      tplinkDevice as unknown as Bulb
    );
  }
  return new HomeKitDevicePlug(
    platform,
    config,
    homebridgeAccessory,
    tplinkDevice as unknown as Plug
  );
}
