import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PlatformAccessory,
  type SerializedPlatformAccessory,
} from "homebridge/lib/platformAccessory";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type SerializedPlatformAccessoryFixture = SerializedPlatformAccessory & {
  fixtureName?: string;
};

type PlatformAccessoryFixture = PlatformAccessory & {
  fixtureName: string;
};

function readFixture(filename: string): SerializedPlatformAccessoryFixture[] {
  return JSON.parse(fs.readFileSync(path.join(__dirname, filename), "utf-8"));
}

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

export const platformAccessories: PlatformAccessoryFixture[] = readFixture(
  "cachedAccessories.json",
).map((serializedAccessory) => deserialize(serializedAccessory));

export const platformAccessoriesIssues = readFixture("cachedAccessoriesIssues.json")
  .map((serializedAccessory) => deserialize(serializedAccessory))
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
