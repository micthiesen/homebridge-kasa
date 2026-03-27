// Ambient module declarations for CJS packages without an "exports" field,
// which NodeNext module resolution requires for deep path imports.
// At runtime these resolve fine; this only satisfies the type checker.
//
// These are homebridge internals with no public API alternative:
// - HomebridgeAPI: the concrete class is not re-exported from "homebridge"
//   (only the API interface is exported as a type)
// - Server, User, PluginManager: used by integration tests to start a real
//   homebridge instance; none are publicly exported as values
// - PlatformAccessory: the constructor is needed in test fixtures but only
//   exported as a type from "homebridge"

declare module "homebridge/lib/api" {
  import type {
    AccessoryPluginConstructor,
    API,
    PlatformAccessory,
    PlatformPluginConstructor,
  } from "homebridge";

  export class HomebridgeAPI implements API {
    readonly version: number;
    readonly serverVersion: string;
    readonly user: API["user"];
    readonly hap: API["hap"];
    readonly hapLegacyTypes: API["hapLegacyTypes"];
    readonly platformAccessory: API["platformAccessory"];
    constructor();
    versionGreaterOrEqual(version: string): boolean;
    signalFinished(): void;
    signalShutdown(): void;
    registerAccessory(
      accessoryName: string,
      constructor: AccessoryPluginConstructor,
    ): void;
    registerAccessory(
      pluginIdentifier: string,
      accessoryName: string,
      constructor: AccessoryPluginConstructor,
    ): void;
    registerPlatform(
      platformName: string,
      constructor: PlatformPluginConstructor,
    ): void;
    registerPlatform(
      pluginIdentifier: string,
      platformName: string,
      constructor: PlatformPluginConstructor,
    ): void;
    publishCameraAccessories(
      pluginIdentifier: string,
      accessories: PlatformAccessory[],
    ): void;
    publishExternalAccessories(
      pluginIdentifier: string,
      accessories: PlatformAccessory[],
    ): void;
    registerPlatformAccessories(
      pluginIdentifier: string,
      platformName: string,
      accessories: PlatformAccessory[],
    ): void;
    updatePlatformAccessories(accessories: PlatformAccessory[]): void;
    unregisterPlatformAccessories(
      pluginIdentifier: string,
      platformName: string,
      accessories: PlatformAccessory[],
    ): void;
    on(event: string, listener: (...args: any[]) => void): this;
  }
}

declare module "homebridge/lib/server" {
  import type { HomebridgeOptions } from "homebridge";

  export class Server {
    constructor(options?: HomebridgeOptions);
    start(): Promise<void>;
    teardown(): void;
  }
}

declare module "homebridge/lib/user" {
  export class User {
    static setStoragePath(...pathSegments: string[]): void;
    static storagePath(): string;
    static configPath(): string;
    static persistPath(): string;
    static cachedAccessoryPath(): string;
  }
}

declare module "homebridge/lib/pluginManager" {
  import type { DynamicPlatformPlugin, PlatformPluginConstructor } from "homebridge";

  interface Plugin {
    readonly pluginName: string;
    readonly disabled: boolean;
    readonly pluginPath: string;
    getPlatformConstructor(platformName: string): PlatformPluginConstructor | undefined;
    getActiveDynamicPlatform(platformName: string): DynamicPlatformPlugin | undefined;
  }

  export class PluginManager {
    getPluginForPlatform(platformIdentifier: string): Plugin;
  }
}

declare module "homebridge/lib/platformAccessory" {
  import type {
    Categories,
    PlatformAccessory as PlatformAccessoryType,
    UnknownContext,
  } from "homebridge";

  export interface SerializedPlatformAccessory {
    displayName: string;
    UUID: string;
    category: number;
    context: UnknownContext;
    plugin: string;
    platform: string;
    services: unknown[];
  }

  export class PlatformAccessory<T extends UnknownContext = UnknownContext> {
    displayName: string;
    UUID: string;
    category: Categories;
    context: T;
    services: PlatformAccessoryType["services"];
    reachable: boolean;
    _associatedPlugin?: string;
    _associatedPlatform?: string;
    _associatedHAPAccessory: PlatformAccessoryType["_associatedHAPAccessory"];
    constructor(displayName: string, uuid: string, category?: Categories);
    addService: PlatformAccessoryType["addService"];
    removeService: PlatformAccessoryType["removeService"];
    getService: PlatformAccessoryType["getService"];
    getServiceById: PlatformAccessoryType["getServiceById"];
    configureController: PlatformAccessoryType["configureController"];
    removeController: PlatformAccessoryType["removeController"];
    static serialize(accessory: PlatformAccessory): SerializedPlatformAccessory;
    static deserialize(json: SerializedPlatformAccessory): PlatformAccessory;
  }
}
