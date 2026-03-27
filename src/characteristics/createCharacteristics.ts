import type { Characteristic as CharacteristicClass, WithUUID } from "homebridge";
import { createAmperes } from "./Amperes.js";
import { createDefaultCharacteristic } from "./DefaultCharacteristic.js";
import { createKilowattHours } from "./KilowattHours.js";
import { createKilowattVoltAmpereHour } from "./KilowattVoltAmpereHour.js";
import { createVoltAmperes } from "./VoltAmperes.js";
import { createVolts } from "./Volts.js";
import { createWatts } from "./Watts.js";

export function createCharacteristics(
  Characteristic: typeof CharacteristicClass,
): Record<
  | "Amperes"
  | "KilowattHours"
  | "KilowattVoltAmpereHour"
  | "VoltAmperes"
  | "Volts"
  | "Watts",
  WithUUID<new () => CharacteristicClass>
> {
  const DefaultCharacteristic = createDefaultCharacteristic(Characteristic);

  return {
    Amperes: createAmperes(DefaultCharacteristic),
    KilowattHours: createKilowattHours(DefaultCharacteristic),
    KilowattVoltAmpereHour: createKilowattVoltAmpereHour(DefaultCharacteristic),
    VoltAmperes: createVoltAmperes(DefaultCharacteristic),
    Volts: createVolts(DefaultCharacteristic),
    Watts: createWatts(DefaultCharacteristic),
  };
}
