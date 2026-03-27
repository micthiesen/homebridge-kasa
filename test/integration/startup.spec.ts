import path from "node:path";
import fs from "fs-extra";
import { HAPStorage } from "hap-nodejs";
import type { DynamicPlatformPlugin, PlatformPluginConstructor } from "homebridge";
import type { PluginManager } from "homebridge/lib/pluginManager";
import { Server } from "homebridge/lib/server";
import { User } from "homebridge/lib/user";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { PLATFORM_NAME, PLUGIN_NAME } from "../../src/settings";

const platformIdentifier = `${PLUGIN_NAME}.${PLATFORM_NAME}`;

function getPlugin(homebridgeServer: Server) {
  // @ts-expect-error: Accessing private
  const { pluginManager }: { pluginManager: PluginManager } = homebridgeServer;
  const plugin = pluginManager.getPluginForPlatform(platformIdentifier);

  return plugin;
}

describe("homebridge", () => {
  const homebridgeStorageFolder = path.resolve(__dirname, "fixtures", "temp");
  const pluginPath = path.resolve(__dirname, "..", "..");

  function setupHomebridge(scenarioName: string) {
    const scenarioDir = path.resolve(__dirname, "fixtures", "homebridge", scenarioName);

    fs.emptyDirSync(homebridgeStorageFolder);
    fs.copySync(scenarioDir, homebridgeStorageFolder);

    return new Server({
      customPluginPath: pluginPath,
      customStoragePath: homebridgeStorageFolder,
      hideQRCode: true,
    });
  }

  beforeAll(async () => {
    // Storage path can only be set before being accessed
    User.setStoragePath(homebridgeStorageFolder);
    HAPStorage.setCustomStoragePath(User.persistPath());
  });

  [
    { name: "fresh-no-config", shouldInitPlatform: false },
    { name: "fresh-with-config", shouldInitPlatform: true },
    {
      name: "persist-no-accessories-with-config",
      shouldInitPlatform: true,
    },
    {
      name: "persist-no-platform-config",
      shouldInitPlatform: false,
    },
    { name: "persist-with-config", shouldInitPlatform: true },
  ].forEach((scenario) => {
    describe(scenario.name, () => {
      let homebridgeServer: Server;
      let tplinkSmarthomePlugin: ReturnType<typeof getPlugin>;
      let tplinkSmarthomePlatform: PlatformPluginConstructor | undefined;
      let activeDynamicPlatform: DynamicPlatformPlugin | undefined;

      beforeEach(async () => {
        homebridgeServer = setupHomebridge(scenario.name);
        await homebridgeServer.start();

        tplinkSmarthomePlugin = getPlugin(homebridgeServer);
        tplinkSmarthomePlatform =
          tplinkSmarthomePlugin.getPlatformConstructor(PLATFORM_NAME);
        activeDynamicPlatform =
          tplinkSmarthomePlugin.getActiveDynamicPlatform(PLATFORM_NAME);
      }, 5000);

      afterEach(() => {
        homebridgeServer.teardown();
        vi.resetAllMocks();
      });

      it("plugin was loaded", () => {
        expect(tplinkSmarthomePlugin).toHaveProperty("pluginName", PLUGIN_NAME);
        expect(tplinkSmarthomePlugin).toHaveProperty("disabled", false);
        expect(tplinkSmarthomePlugin).toHaveProperty("pluginPath", pluginPath);
        expect(tplinkSmarthomePlatform).toBeInstanceOf(Function);
      });

      describe("startup", () => {
        if (scenario.shouldInitPlatform) {
          it("should load Platform", () => {
            expect(activeDynamicPlatform).toBeInstanceOf(tplinkSmarthomePlatform);
          });
        } else {
          it("should not load Platform", () => {
            expect(activeDynamicPlatform).toBeUndefined();
          });
        }
      });
    });
  });
});
