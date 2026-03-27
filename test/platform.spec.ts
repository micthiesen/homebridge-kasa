import { EventEmitter } from "node:events";
import { HomebridgeAPI } from "homebridge/lib/api";
import { beforeEach, describe, expect, it } from "vitest";

import { TplinkSmarthomePlatform } from "../src/TplinkSmarthomePlatform.js";

import {
  platformAccessories,
  platformAccessoriesIssues,
} from "./fixtures/platform-accessories/index.js";

const log = () => {};
log.prefix = "";
log.debug = () => {};
log.error = () => {};
log.info = () => {};
log.success = () => {};
log.log = () => {};
log.warn = () => {};

describe("TplinkSmarthomePlatform", () => {
  let platform: TplinkSmarthomePlatform;
  let tplinkDevice: EventEmitter;
  beforeEach(() => {
    platform = new TplinkSmarthomePlatform(
      log,
      { platform: "", name: "tplink" },
      new HomebridgeAPI(),
    );

    tplinkDevice = new EventEmitter();
    Object.assign(tplinkDevice, {
      id: "ABC",
      deviceType: "plug",
      model: "HS100",
      supportsDimmer: false,
      alias: "TEST",
    });
  });

  describe("#addAccessory", () => {
    it.skip("should add platformAccessory to #homebridgeAccessories", () => {});
  });

  describe("#configureAccessory", () => {
    platformAccessories.forEach((platformAccessory) => {
      describe(platformAccessory.displayName, () => {
        it("should add platformAccessory to #configuredAccessories", () => {
          platform.configureAccessory(platformAccessory as any);

          // biome-ignore lint/complexity/useLiteralKeys: accessing private property in test
          const hbAccessories = platform["configuredAccessories"];

          expect(hbAccessories).toBeInstanceOf(Map);
          expect(hbAccessories).toHaveProperty("size", 1);
          expect(hbAccessories.get(platformAccessory.UUID)).toBe(platformAccessory);
        });
      });
    });

    describe("Context Missing", () => {
      it("should add platformAccessory to #configuredAccessories", () => {
        const platformAccessory = platformAccessoriesIssues.get("CONTEXT_MISSING");
        platform.configureAccessory(platformAccessory as any);

        // biome-ignore lint/complexity/useLiteralKeys: accessing private property in test
        const hbAccessories = platform["configuredAccessories"];

        expect(hbAccessories).toBeInstanceOf(Map);
        expect(hbAccessories).toHaveProperty("size", 1);
        expect(hbAccessories.get(platformAccessory.UUID)).toBe(platformAccessory);
      });
    });
  });
});
