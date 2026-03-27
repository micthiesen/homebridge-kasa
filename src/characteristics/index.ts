import type { Characteristic as CharacteristicClass, WithUUID } from "homebridge";
import AmperesImport from "./amperes.js";
import DefaultCharacteristicImport from "./default-characteristic.js";
import KilowattHoursImport from "./kilowatt-hours.js";
import KilowattVoltAmpereHourImport from "./kilowatt-volt-ampere-hour.js";
import VoltAmperesImport from "./volt-amperes.js";
import VoltsImport from "./volts.js";
import WattsImport from "./watts.js";

export default function characteristic(
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
  const DefaultCharacteristic = DefaultCharacteristicImport(Characteristic);

  return {
    Amperes: AmperesImport(DefaultCharacteristic),
    KilowattHours: KilowattHoursImport(DefaultCharacteristic),
    KilowattVoltAmpereHour: KilowattVoltAmpereHourImport(DefaultCharacteristic),
    VoltAmperes: VoltAmperesImport(DefaultCharacteristic),
    Volts: VoltsImport(DefaultCharacteristic),
    Watts: WattsImport(DefaultCharacteristic),
  };
}
