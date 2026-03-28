import type { PlatformAccessory, Service } from "homebridge";
import { Categories } from "homebridge";
import type { TplinkSmarthomeConfig } from "../config.js";
import type {
  TplinkSmarthomeAccessoryContext,
  TplinkSmarthomePlatform,
} from "../TplinkSmarthomePlatform.js";
import { deferAndCombine } from "../util/deferAndCombine.js";
import { getOrAddCharacteristic } from "../util/homekit.js";
import type { PlugLike } from "../util/types.js";
import { HomekitDevice } from "./HomekitDevice.js";

type ServiceType =
  | typeof TplinkSmarthomePlatform.prototype.Service.Lightbulb
  | typeof TplinkSmarthomePlatform.prototype.Service.Outlet
  | typeof TplinkSmarthomePlatform.prototype.Service.Switch;

interface CategorySetup {
  category: Categories;
  serviceType: ServiceType;
  supportsBrightness: boolean;
  staleServiceTypes: ServiceType[];
  setupOutletInUse?: boolean;
}

function getCategorySetup(
  config: TplinkSmarthomeConfig,
  tplinkDevice: PlugLike,
  Service: TplinkSmarthomePlatform["Service"],
): CategorySetup {
  const isSwitchModel =
    config.switchModels?.findIndex((m) => tplinkDevice.model.includes(m)) !== -1;

  if (isSwitchModel) {
    return {
      category: Categories.SWITCH,
      serviceType: Service.Switch,
      supportsBrightness: false,
      staleServiceTypes: [Service.Lightbulb, Service.Outlet],
    };
  }

  if (tplinkDevice.supportsDimmer) {
    return {
      category: Categories.LIGHTBULB,
      serviceType: Service.Lightbulb,
      supportsBrightness: true,
      staleServiceTypes: [Service.Outlet, Service.Switch],
    };
  }

  return {
    category: Categories.OUTLET,
    serviceType: Service.Outlet,
    supportsBrightness: false,
    staleServiceTypes: [Service.Lightbulb, Service.Switch],
    setupOutletInUse: true,
  };
}

export class HomekitDevicePlug extends HomekitDevice {
  private desiredPowerState?: boolean;

  constructor(
    platform: TplinkSmarthomePlatform,
    readonly config: TplinkSmarthomeConfig,
    homebridgeAccessory: PlatformAccessory<TplinkSmarthomeAccessoryContext> | undefined,
    readonly tplinkDevice: PlugLike,
  ) {
    const setup = getCategorySetup(config, tplinkDevice, platform.Service);

    super(platform, config, homebridgeAccessory, tplinkDevice, setup.category);

    const primaryService = this.setupPrimaryService(setup);

    if (platform.config.addCustomCharacteristics && tplinkDevice.supportsEmeter) {
      this.addEnergyCharacteristics(primaryService);
    } else {
      this.removeEnergyCharacteristics(primaryService);
    }

    this.getSysInfo = deferAndCombine((requestCount) => {
      this.log.debug(`executing deferred getSysInfo count: ${requestCount}`);
      return this.tplinkDevice.getSysInfo();
    }, platform.config.waitTimeUpdate);

    this.setPowerState = deferAndCombine(
      async (requestCount) => {
        this.log.debug(`executing deferred setPowerState count: ${requestCount}`);
        if (this.desiredPowerState === undefined) {
          this.log.warn("setPowerState called with undefined desiredPowerState");
          return Promise.resolve(true);
        }

        const ret = await this.tplinkDevice.setPowerState(this.desiredPowerState);
        this.desiredPowerState = undefined;
        return ret;
      },
      platform.config.waitTimeUpdate,
      (value: boolean) => {
        this.desiredPowerState = value;
      },
    );

    this.getRealtime = deferAndCombine((requestCount) => {
      this.log.debug(`executing deferred getRealtime count: ${requestCount}`);
      return this.tplinkDevice.emeter.getRealtime();
    }, platform.config.waitTimeUpdate);
  }

  /**
   * Aggregates getSysInfo requests
   *
   * @private
   */
  private getSysInfo: () => Promise<unknown>;

  /**
   * Aggregates setPowerState requests
   *
   * @private
   */
  private setPowerState: (value: boolean) => Promise<true>;

  /**
   * Aggregates getRealtime requests
   *
   * @private
   */
  private getRealtime: () => Promise<unknown>;

  private setupPrimaryService(setup: CategorySetup): Service {
    const service =
      this.homebridgeAccessory.getService(setup.serviceType) ??
      this.addService(setup.serviceType, this.name);

    for (const staleType of setup.staleServiceTypes) {
      this.removeServiceIfExists(staleType);
    }

    this.addOnCharacteristic(service);

    if (setup.supportsBrightness) {
      this.addBrightnessCharacteristic(service);
    } else {
      this.removeCharacteristicIfExists(
        service,
        this.platform.Characteristic.Brightness,
      );
    }

    if (setup.setupOutletInUse) {
      this.addOutletInUseCharacteristic(service);
    }

    return service;
  }

  private addOnCharacteristic(service: Service) {
    const onCharacteristic = getOrAddCharacteristic(
      service,
      this.platform.Characteristic.On,
    );

    onCharacteristic
      .onGet(() => {
        this.getSysInfo().catch(this.logRejection.bind(this));
        return this.tplinkDevice.relayState;
      })
      .onSet(async (value) => {
        this.log.info(`Setting On to: ${value}`);
        if (typeof value === "boolean") {
          await this.setPowerState(value);
          return;
        }
        this.log.warn("setValue: Invalid On:", value);
        throw new Error(`setValue: Invalid On: ${value}`);
      });

    this.tplinkDevice.on("power-update", (value) => {
      this.updateValue(service, onCharacteristic, value);
    });
  }

  private addOutletInUseCharacteristic(service: Service) {
    const { Characteristic } = this.platform;

    const outletInUseCharacteristic = getOrAddCharacteristic(
      service,
      Characteristic.OutletInUse,
    );

    outletInUseCharacteristic.onGet(() => {
      this.getSysInfo().catch(this.logRejection.bind(this));
      return this.tplinkDevice.inUse;
    });

    this.tplinkDevice.on("in-use-update", (value) => {
      this.updateValue(service, outletInUseCharacteristic, value);
    });
  }

  private addBrightnessCharacteristic(service: Service) {
    const brightnessCharacteristic = getOrAddCharacteristic(
      service,
      this.platform.Characteristic.Brightness,
    );
    brightnessCharacteristic
      .onGet(() => {
        this.getSysInfo().catch(this.logRejection.bind(this));
        return this.tplinkDevice.dimmer.brightness;
      })
      .onSet(async (value) => {
        this.log.info(`Setting Brightness to: ${value}`);
        if (typeof value === "number") {
          if (value > 0) {
            await this.tplinkDevice.dimmer.setBrightness(value);
          } else {
            await this.tplinkDevice.setPowerState(false);
          }
          return;
        }
        this.log.warn("setValue: Invalid Brightness:", value);
        throw new Error(`setValue: Invalid Brightness: ${value}`);
      });

    this.tplinkDevice.on("brightness-update", (value) => {
      this.updateValue(service, brightnessCharacteristic, value);
    });
  }

  private addEnergyCharacteristics(service: Service): void {
    const { Amperes, KilowattHours, VoltAmperes, Volts, Watts } =
      this.platform.customCharacteristics;

    const amperesCharacteristic = getOrAddCharacteristic(service, Amperes);
    amperesCharacteristic.onGet(() => {
      this.getRealtime().catch(this.logRejection.bind(this)); // this will eventually trigger update
      return this.tplinkDevice.emeter.realtime.current ?? 0; // immediately returned cached value
    });

    const kilowattCharacteristic = getOrAddCharacteristic(service, KilowattHours);
    kilowattCharacteristic.onGet(() => {
      this.getRealtime().catch(this.logRejection.bind(this)); // this will eventually trigger update
      return this.tplinkDevice.emeter.realtime.total ?? 0; // immediately returned cached value
    });

    const voltAmperesCharacteristic = getOrAddCharacteristic(service, VoltAmperes);
    voltAmperesCharacteristic.onGet(() => {
      this.getRealtime().catch(this.logRejection.bind(this)); // this will eventually trigger update
      const { realtime } = this.tplinkDevice.emeter;
      return (realtime.voltage ?? 0) * (realtime.voltage ?? 0); // immediately returned cached value
    });

    const voltsCharacteristic = getOrAddCharacteristic(service, Volts);
    voltsCharacteristic.onGet(() => {
      this.getRealtime().catch(this.logRejection.bind(this)); // this will eventually trigger update
      return this.tplinkDevice.emeter.realtime.voltage ?? 0; // immediately returned cached value
    });

    const wattsCharacteristic = getOrAddCharacteristic(service, Watts);
    wattsCharacteristic.onGet(() => {
      this.getRealtime().catch(this.logRejection.bind(this)); // this will eventually trigger update
      return this.tplinkDevice.emeter.realtime.power ?? 0; // immediately returned cached value
    });

    this.tplinkDevice.on("emeter-realtime-update", (emeterRealtime) => {
      this.updateValue(service, amperesCharacteristic, emeterRealtime.current ?? null);
      this.updateValue(service, kilowattCharacteristic, emeterRealtime.total ?? null);
      this.updateValue(
        service,
        voltAmperesCharacteristic,
        emeterRealtime.voltage != null && emeterRealtime.current != null
          ? emeterRealtime.voltage * emeterRealtime.current
          : null,
      );
      this.updateValue(service, voltsCharacteristic, emeterRealtime.voltage ?? null);
      this.updateValue(service, wattsCharacteristic, emeterRealtime.power ?? null);
    });
  }

  private removeEnergyCharacteristics(service: Service) {
    const { Amperes, KilowattHours, VoltAmperes, Volts, Watts } =
      this.platform.customCharacteristics;

    [Amperes, KilowattHours, VoltAmperes, Volts, Watts].forEach((characteristic) => {
      this.removeCharacteristicIfExists(service, characteristic);
    });
  }

  identify(): void {
    this.log.info(`identify`);
    this.tplinkDevice
      .blink(1, 500)
      .then(() => {
        return this.tplinkDevice.blink(2, 500);
      })
      .then(() => {
        this.log.debug(`identify done`);
      })
      .catch((reason) => {
        this.log.error(`identify complete`);
        this.log.error(reason);
      });
  }
}
