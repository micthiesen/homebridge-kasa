/// <reference path="../../types/node-persist.d.ts" />

import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PlatformAccessory,
  type SerializedPlatformAccessory,
} from "homebridge/lib/platformAccessory";
import nodePersist from "node-persist";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type SerializedPlatformAccessoryFixture = SerializedPlatformAccessory & {
  fixtureName?: string;
};

type PlatformAccessoryFixture = PlatformAccessory & {
  fixtureName: string;
};

const accessoryStorage = nodePersist.create();

const deserialize = function deserialize(
  serializedAccessory: SerializedPlatformAccessoryFixture,
): PlatformAccessoryFixture {
  const platformAccessory: PlatformAccessory = new PlatformAccessory(
    serializedAccessory.displayName,
    serializedAccessory.UUID,
    serializedAccessory.category,
  );

  PlatformAccessory.deserialize(serializedAccessory);

  if (serializedAccessory.fixtureName != null) {
    (platformAccessory as PlatformAccessoryFixture).fixtureName =
      serializedAccessory.fixtureName;
  }

  return platformAccessory as PlatformAccessoryFixture;
};

accessoryStorage.initSync({ dir: __dirname });

export const platformAccessories: PlatformAccessoryFixture[] = accessoryStorage
  .getItem("cachedAccessories.json")
  .map((serializedAccessory: SerializedPlatformAccessoryFixture) =>
    deserialize(serializedAccessory),
  );

export const platformAccessoriesIssues = accessoryStorage
  .getItem("cachedAccessoriesIssues.json")
  .map((serializedAccessory: SerializedPlatformAccessoryFixture) =>
    deserialize(serializedAccessory),
  )
  .reduce(
    (
      map: Map<string, PlatformAccessoryFixture>,
      platformAccessory: PlatformAccessoryFixture,
    ) => {
      map.set(platformAccessory.fixtureName, platformAccessory);
      return map;
    },
    new Map(),
  );
