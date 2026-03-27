import type { CharacteristicProps } from "homebridge";
import { Formats, Perms } from "homebridge";
import type DefaultCharacteristicClass from "./types.js";

export function createDefaultCharacteristic(
  Characteristic: typeof DefaultCharacteristicClass,
): typeof DefaultCharacteristicClass {
  return class DefaultCharacteristic extends Characteristic {
    constructor(
      displayName: string,
      UUID: string,
      props?: Omit<CharacteristicProps, "format" | "perms"> &
        Partial<Pick<CharacteristicProps, "format" | "perms">>,
    ) {
      const combinedProps = {
        format: Formats.FLOAT,
        minValue: 0,
        maxValue: 65535,
        perms: [Perms.PAIRED_READ, Perms.NOTIFY],
        ...props,
      };
      super(displayName, UUID, combinedProps);
      this.value = this.getDefaultValue();
    }
  };
}
