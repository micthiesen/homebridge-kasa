import { describe, expect, it } from "vitest";

import { ConfigParseError, defaultConfig, parseConfig } from "../src/config";

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
      }).toThrow(ConfigParseError);
      expect(() => {
        parseConfig(configInvalid);
      }).toThrow("must be");
    });

    it("should throw ConfigParseError with incorrect devices", () => {
      expect(() => {
        parseConfig({
          devices: [{ host: 123 }],
        });
      }).toThrow(ConfigParseError);
      expect(() => {
        parseConfig({
          devices: [{ host: 123 }],
        });
      }).toThrow("`devices/0/host` must be string");

      expect(() => {
        parseConfig({
          devices: [{ port: 123 }],
        });
      }).toThrow(ConfigParseError);
      expect(() => {
        parseConfig({
          devices: [{ port: 123 }],
        });
      }).toThrow(
        "`devices/0` must have required property 'host'\n`devices/0/port` must be string",
      );

      expect(() => {
        parseConfig({
          devices: [{ badHost: "host" }],
        });
      }).toThrow(ConfigParseError);
      expect(() => {
        parseConfig({
          devices: [{ badHost: "host" }],
        });
      }).toThrow("`devices/0` must have required property 'host'");

      expect(() => {
        parseConfig({
          devices: [{ badHost: "host" }],
        });
      }).toThrow(ConfigParseError);
      expect(() => {
        parseConfig({
          devices: [{ badHost: "host" }],
        });
      }).toThrow("`devices/0` must have required property 'host'");
    });
  });
});
