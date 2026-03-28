import { describe, expect, it } from "vitest";

import { defaultConfig, parseConfig } from "../src/config.js";

describe("config", () => {
  describe("parseConfig", () => {
    const minimalConfig = {
      platform: "TplinkSmarthomeApi",
      name: "tplinkSmarthomeApi",
    };

    const configInvalid = {
      platform: "TplinkSmarthomeApi",
      name: "tplinkSmarthomeApi",
      addCustomCharacteristics: "true",
      inUseThreshold: "foo",
      switchModels: "foo",
      discoveryPort: "foo",
      broadcast: 255,
      pollingInterval: "foo",
      deviceTypes: [],
      macAddresses: [],
      excludeMacAddresses: [],
      devices: [],
      timeout: "foo",
      transport: "foo",
      waitTimeUpdate: "foo",
    };

    it("should provide defaults with no config options", () => {
      const parsedConfig = parseConfig(minimalConfig);
      expect(parsedConfig).not.toBeNull();

      const parsedDefaultConfig = parseConfig({
        ...defaultConfig,
        name: "defaultName",
      });
      expect(parsedConfig).toEqual(parsedDefaultConfig);
    });

    it("should throw ConfigParseError with incorrect types", () => {
      expect(() => {
        parseConfig(configInvalid);
      }).toThrow("Error parsing config");
    });

    it("should throw ConfigParseError with incorrect devices", () => {
      expect(() => {
        parseConfig({
          devices: [{ host: 123 }],
        });
      }).toThrow("Error parsing config");

      expect(() => {
        parseConfig({
          devices: [{ port: 123 }],
        });
      }).toThrow("Error parsing config");

      expect(() => {
        parseConfig({
          devices: [{ badHost: "host" }],
        });
      }).toThrow("Error parsing config");
    });
  });
});
