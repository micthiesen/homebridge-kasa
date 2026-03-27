import type {
  Characteristic as CharacteristicClass,
  CharacteristicProps,
} from "homebridge";

declare class DefaultCharacteristicClass extends CharacteristicClass {
  constructor(
    displayName: string,
    UUID: string,
    props?: Omit<CharacteristicProps, "format" | "perms"> &
      Partial<Pick<CharacteristicProps, "format" | "perms">>,
  );
}

export default DefaultCharacteristicClass;
