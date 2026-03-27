import type { WithUUID } from "homebridge";
import { Formats } from "homebridge";
import type DefaultCharacteristicClass from "./types.js";

export function createKilowattVoltAmpereHour(
  DefaultCharacteristic: typeof DefaultCharacteristicClass,
): WithUUID<new () => DefaultCharacteristicClass> {
  return class KilowattVoltAmpereHour extends DefaultCharacteristic {
    static readonly UUID = "E863F127-079E-48FF-8F27-9C2605A29F52";

    constructor() {
      super("Apparent Energy", KilowattVoltAmpereHour.UUID, {
        format: Formats.UINT32,
        unit: "kVAh",
        minStep: 1,
      });
    }
  };
}
