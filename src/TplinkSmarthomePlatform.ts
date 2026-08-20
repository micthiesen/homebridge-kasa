import { DefaultMap } from "@micthiesen/mitools/collections";
import chalk from "chalk";
import type {
  API,
  Characteristic,
  DynamicPlatformPlugin,
  Logging,
  PlatformAccessory,
  PlatformConfig,
  Service,
  WithUUID,
} from "homebridge";
import { APIEvent, Categories } from "homebridge";
import { satisfies } from "semver";
import type { Sysinfo } from "tplink-smarthome-api";
import { Client } from "tplink-smarthome-api";
import packageConfig from "../package.json" with { type: "json" };
import { createCharacteristics } from "./characteristics/createCharacteristics.js";
import type { TplinkSmarthomeConfig } from "./config.js";
import { parseConfig } from "./config.js";
import { createHomekitDevice } from "./devices/createHomekitDevice.js";
import type { HomekitDevice } from "./devices/HomekitDevice.js";
import type { KlapBulb } from "./klap/KlapBulb.js";
import { KlapDiscovery } from "./klap/KlapDiscovery.js";
import type { KlapPlug } from "./klap/KlapPlug.js";
import { PLATFORM_NAME, PLUGIN_NAME } from "./settings.js";
import { lookup, lookupCharacteristicNameByUUID } from "./util/homekit.js";
import type { TplinkDevice } from "./util/types.js";
import { isObjectLike } from "./util/types.js";

export type TplinkSmarthomeAccessoryContext = {
  deviceId?: string;
};

export class TplinkSmarthomePlatform implements DynamicPlatformPlugin {
  public readonly Service;

  public readonly Characteristic;

  public customCharacteristics: ReturnType<typeof createCharacteristics>;

  public config: TplinkSmarthomeConfig;

  private readonly configuredAccessories: Map<
    string,
    PlatformAccessory<TplinkSmarthomeAccessoryContext>
  > = new Map();

  private readonly homekitDevicesById: Map<string, HomekitDevice> = new Map();

  private readonly categories: Map<Categories, string> = new Map();

  private readonly legacyClient: Client;

  private readonly klapDiscovery: KlapDiscovery | undefined;

  private shuttingDown = false;

  private emeterTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    public readonly log: Logging,
    config: PlatformConfig,
    public readonly api: API,
  ) {
    this.log.info(
      "%s v%s, node %s, homebridge v%s, api v%s",
      packageConfig.name,
      packageConfig.version,
      process.version,
      api.serverVersion,
      api.version,
    );
    if (!satisfies(process.version, packageConfig.engines.node)) {
      this.log.error(
        "Error: not using minimum node version %s",
        packageConfig.engines.node,
      );
    }
    if (api.versionGreaterOrEqual == null || !api.versionGreaterOrEqual("1.3.0")) {
      this.log.error(
        `homebridge-tplink-smarthome requires homebridge >= 1.3.0. Currently running: ${api.serverVersion}`,
      );
      throw new Error(
        `homebridge-tplink-smarthome requires homebridge >= 1.3.0. Currently running: ${api.serverVersion}`,
      );
    }

    this.Service = this.api.hap.Service;
    this.Characteristic = this.api.hap.Characteristic;

    this.log.debug("config.json: %j", config);
    this.config = parseConfig(config);
    this.log.debug("config: %j", this.config);

    this.customCharacteristics = createCharacteristics(api.hap.Characteristic);

    this.categories.set(Categories.LIGHTBULB, "LIGHTBULB");
    this.categories.set(Categories.OUTLET, "OUTLET");
    this.categories.set(Categories.SWITCH, "SWITCH");

    this.legacyClient = this.setupLegacyDiscovery();
    this.klapDiscovery = this.setupKlapDiscovery();
    this.setupLifecycleHandlers();
  }

  private setupLegacyDiscovery(): Client {
    const tplinkApiLogger: Logging = Object.assign(() => {}, this.log, {
      prefix: `${this.log.prefix || PLATFORM_NAME}.API`,
    });

    const client = new Client({
      logger: tplinkApiLogger,
      defaultSendOptions: this.config.defaultSendOptions,
    });

    client.on("device-new", (device: TplinkDevice) => {
      this.log.info(
        `[Legacy] Device First Online: ${chalk.blue(`[${device.alias}]`)} %s [%s]`,
        device.deviceType,
        device.id,
        device.host,
        device.port,
      );
      this.foundDevice(device);
    });

    client.on("device-online", (device: TplinkDevice) => {
      this.log.debug(
        `[Legacy] Device Online: ${chalk.blue(`[${device.alias}]`)} %s [%s]`,
        device.deviceType,
        device.id,
        device.host,
        device.port,
      );
      this.foundDevice(device);
    });

    client.on("device-offline", (device: TplinkDevice) => {
      const deviceAccessory = this.homekitDevicesById.get(device.id);

      if (deviceAccessory !== undefined) {
        this.log.debug(
          `[Legacy] Device Offline: ${chalk.blue(`[${device.alias}]`)} %s [%s]`,
          deviceAccessory.homebridgeAccessory.displayName,
          device.deviceType,
          device.id,
          device.host,
          device.port,
        );
      }
    });

    return client;
  }

  private setupKlapDiscovery(): KlapDiscovery | undefined {
    // KLAP/AES/TPAP discovery for newer devices (port 80)
    // Only enabled when Kasa credentials are configured
    if (!this.config.kasaCredentials) {
      this.log.info(
        "No Kasa credentials configured. Newer devices using KLAP/AES/TPAP protocols will not be discovered. " +
          "Set kasaUsername and kasaPassword in config to enable.",
      );
      return undefined;
    }

    this.log.info(
      "Kasa credentials configured, enabling KLAP/AES/TPAP discovery for newer devices",
    );

    const klapDiscovery = new KlapDiscovery({
      credentials: this.config.kasaCredentials,
      devices: this.config.discoveryOptions.devices,
      broadcast: this.config.discoveryOptions.broadcast,
      discoveryInterval: this.config.discoveryOptions.discoveryInterval,
      timeout: this.config.defaultSendOptions.timeout,
    });

    klapDiscovery.on("device-new", (device: KlapPlug | KlapBulb) => {
      const proto = device.transportType.toUpperCase();
      this.log.info(
        `[${proto}] Device First Online: ${chalk.blue(`[${device.alias}]`)} %s [%s]`,
        device.deviceType,
        device.id,
        device.host,
        device.port,
      );
      this.foundDevice(device);
    });

    klapDiscovery.on("device-online", (device: KlapPlug | KlapBulb) => {
      this.log.debug(
        `[KLAP] Device Online: ${chalk.blue(`[${device.alias}]`)} %s [%s]`,
        device.deviceType,
        device.id,
        device.host,
        device.port,
      );
      this.foundDevice(device);
    });

    klapDiscovery.on("device-offline", (device: KlapPlug | KlapBulb) => {
      const deviceAccessory = this.homekitDevicesById.get(device.id);
      if (deviceAccessory !== undefined) {
        this.log.debug(
          `[KLAP] Device Offline: ${chalk.blue(`[${device.alias}]`)} %s [%s]`,
          deviceAccessory.homebridgeAccessory.displayName,
          device.deviceType,
          device.id,
          device.host,
          device.port,
        );
      }
    });

    klapDiscovery.on("warning", (msg: string) => {
      this.log.warn("[KLAP] %s", msg);
    });

    klapDiscovery.on("debug", (msg: string) => {
      this.log.debug("[KLAP] %s", msg);
    });

    klapDiscovery.on("error", (err: Error) => {
      this.log.error("[KLAP] Discovery error: %s", err.message);
      this.log.debug("[KLAP] %O", err);
    });

    return klapDiscovery;
  }

  private setupLifecycleHandlers(): void {
    this.api.on(APIEvent.DID_FINISH_LAUNCHING, () => {
      this.log.debug(APIEvent.DID_FINISH_LAUNCHING);

      this.legacyClient.startDiscovery({
        ...this.config.discoveryOptions,
        filterCallback: (si: Sysinfo) => {
          return si.deviceId != null && si.deviceId.length > 0;
        },
      });

      // Start KLAP/AES/TPAP discovery alongside legacy (if credentials configured)
      if (this.klapDiscovery) {
        this.klapDiscovery.start();
      }

      if (this.config.emeterPollingInterval > 0) this.refreshEmeter();
    });

    this.api.on("shutdown", () => {
      this.log.debug("shutdown");
      this.shuttingDown = true;
      if (this.emeterTimer) {
        clearTimeout(this.emeterTimer);
        this.emeterTimer = null;
      }
      this.legacyClient.stopDiscovery();
      if (this.klapDiscovery) {
        this.klapDiscovery.stop();
      }
    });
  }

  private async refreshEmeter(): Promise<void> {
    this.log.debug(`${chalk.magenta("refreshEmeter()")}`);
    if (this.config.emeterPollingInterval <= 0) return;

    try {
      const deviceAccessories = this.deviceAccessoriesByHost;
      const promises: Promise<unknown>[] = [];

      for (const accForHost of deviceAccessories.values()) {
        promises.push(this.refreshEmeterForAccessories(accForHost));
      }
      await Promise.allSettled(promises);
    } catch (err) {
      this.log.error(`Error in ${chalk.magenta("refreshEmeter()")}:`);
      this.log.error(String(err));
    } finally {
      if (!this.shuttingDown) {
        this.log.debug(
          `Scheduling next run of ${chalk.magenta("refreshEmeter()")} in %d(ms)`,
          this.config.emeterPollingInterval,
        );
        this.emeterTimer = setTimeout(() => {
          this.refreshEmeter().catch((err) => {
            this.log.error("Unexpected error in refreshEmeter: %s", String(err));
          });
        }, this.config.emeterPollingInterval);
      }
    }
  }

  private async refreshEmeterForAccessories(
    accessories: HomekitDevice[],
  ): Promise<void> {
    for (const acc of accessories) {
      const device = acc.tplinkDevice;
      if (device.supportsEmeter) {
        this.log.debug(`getEmeterRealtime ${chalk.blue(`[${device.alias}]`)}`);
        await device.emeter.getRealtime().catch((reason) => {
          this.log.error("[%s] %s", device.alias, "emeter.getRealtime()");
          this.log.error(reason);
        });
      }
    }
  }

  /**
   * Return string representation of Service/Characteristic for logging
   *
   * @internal
   */
  public lsc(
    serviceOrCharacteristic: Service | Characteristic | { UUID: string },
    characteristic?: Characteristic | { UUID: string },
  ): string {
    let serviceName: string | undefined;
    let characteristicName: string | undefined;

    if (serviceOrCharacteristic instanceof this.api.hap.Service) {
      serviceName = this.getServiceName(serviceOrCharacteristic);
    } else if (
      serviceOrCharacteristic instanceof this.api.hap.Characteristic ||
      ("UUID" in serviceOrCharacteristic &&
        typeof serviceOrCharacteristic.UUID === "string")
    ) {
      characteristicName = this.getCharacteristicName(serviceOrCharacteristic);
    }

    if (characteristic instanceof this.api.hap.Characteristic) {
      characteristicName = this.getCharacteristicName(characteristic);
    }

    if (serviceName != null && characteristicName != null) {
      return `[${chalk.yellow(serviceName)}.${chalk.green(characteristicName)}]`;
    }
    if (serviceName !== undefined) return `[${chalk.yellow(serviceName)}]`;
    return `[${chalk.green(characteristicName)}]`;
  }

  private get deviceAccessoriesByHost(): DefaultMap<string, HomekitDevice[]> {
    const byHost = new DefaultMap<string, HomekitDevice[]>(() => []);
    for (const [, tpLinkAccessory] of this.homekitDevicesById) {
      byHost.get(tpLinkAccessory.tplinkDevice.host).push(tpLinkAccessory);
    }
    return byHost;
  }

  private createHomekitDevice(
    accessory: PlatformAccessory<TplinkSmarthomeAccessoryContext> | undefined,
    tplinkDevice: TplinkDevice,
  ): HomekitDevice {
    return createHomekitDevice(this, this.config, accessory, tplinkDevice);
  }

  getCategoryName(category: Categories): string | undefined {
    return this.categories.get(category);
  }

  getServiceName(service: { UUID: string }): string | undefined {
    return lookup(
      this.api.hap.Service,
      (thisKeyValue, value) =>
        isObjectLike(thisKeyValue) &&
        "UUID" in thisKeyValue &&
        thisKeyValue.UUID === value,
      service.UUID,
    );
  }

  getCharacteristicName(
    characteristic: WithUUID<{ name?: string; displayName?: string }>,
  ): string | undefined {
    if ("name" in characteristic && characteristic.name !== undefined)
      return characteristic.name;
    if ("displayName" in characteristic && characteristic.displayName !== undefined)
      return characteristic.displayName;

    if ("UUID" in characteristic) {
      return lookupCharacteristicNameByUUID(
        this.api.hap.Characteristic,
        characteristic.UUID,
      );
    }
    return undefined;
  }

  /**
   * Registers a Homebridge PlatformAccessory.
   *
   * Calls {@link external:homebridge.API#registerPlatformAccessories}
   */
  registerPlatformAccessory(
    platformAccessory: PlatformAccessory<TplinkSmarthomeAccessoryContext>,
  ): void {
    this.log.debug(
      `registerPlatformAccessory(${chalk.blue(`[${platformAccessory.displayName}]`)})`,
    );
    this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [
      platformAccessory,
    ]);
  }

  /**
   * Function invoked when homebridge tries to restore cached accessory
   */
  configureAccessory(
    accessory: PlatformAccessory<TplinkSmarthomeAccessoryContext>,
  ): void {
    this.log.info(
      `Configuring cached accessory: ${chalk.blue(
        `[${accessory.displayName}]`,
      )} UUID: ${accessory.UUID} deviceId: %s `,
      accessory.context?.deviceId,
    );
    this.log.debug("%O", accessory.context);

    this.configuredAccessories.set(accessory.UUID, accessory);
  }

  /**
   * Adds a new or existing real device.
   */
  private foundDevice(device: TplinkDevice): void {
    const deviceId = device.id;

    if (deviceId == null || deviceId.length === 0) {
      this.log.error("Missing deviceId: %s", device.host);
      return;
    }

    if (this.homekitDevicesById.get(deviceId) !== undefined) {
      return;
    }

    this.log.info(
      `Adding: ${chalk.blue(`[${device.alias}]`)} %s [%s]`,
      device.deviceType,
      deviceId,
    );

    const uuid = this.api.hap.uuid.generate(deviceId);
    const accessory = this.configuredAccessories.get(uuid);

    this.homekitDevicesById.set(device.id, this.createHomekitDevice(accessory, device));
  }
}
