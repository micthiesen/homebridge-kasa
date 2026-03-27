import type { Characteristic, Service, WithUUID } from "homebridge";

import { isObjectLike } from "./types.js";

export function getOrAddCharacteristic(
  service: Service,
  characteristic: WithUUID<new () => Characteristic>,
): Characteristic {
  if (
    !hasCharacteristic(
      service.characteristics.concat(service.optionalCharacteristics),
      characteristic,
    )
  ) {
    // This it to suppress warning: Characteristic not in required or optional characteristic section for service
    service.addOptionalCharacteristic(characteristic);
  }

  return (
    service.getCharacteristic(characteristic) ||
    service.addCharacteristic(characteristic)
  );
}

export function hasCharacteristic(
  characteristics: Array<Characteristic>,
  characteristic: WithUUID<{ new (): Characteristic }>,
): boolean {
  return (
    characteristics.find((char) => {
      if (char instanceof characteristic) return true;
      return (char as Characteristic).UUID === characteristic.UUID;
    }) !== undefined
  );
}

export function kelvinToMired(kelvin: number): number {
  return 1e6 / kelvin;
}

export function miredToKelvin(mired: number): number {
  return 1e6 / mired;
}

export function lookup<T>(
  object: unknown,
  compareFn: undefined | ((objectProp: unknown, search: T) => boolean),
  value: T,
): string | undefined {
  const compare =
    compareFn ?? ((objectProp: unknown, search: T): boolean => objectProp === search);

  if (isObjectLike(object)) {
    const keys = Object.keys(object);
    for (let i = 0; i < keys.length; i += 1) {
      if (compare(object[keys[i]], value)) {
        return keys[i];
      }
    }
  }
  return undefined;
}

export function lookupCharacteristicNameByUUID(
  characteristic: typeof Characteristic,
  uuid: string,
): string | undefined {
  const record = characteristic as unknown as Record<string, unknown>;
  const keys = Object.keys(record);
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    const c = record[key];
    if (isObjectLike(c) && "UUID" in c && c.UUID === uuid) {
      return key;
    }
  }
  return undefined;
}
