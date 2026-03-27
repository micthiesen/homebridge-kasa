// Ambient module declarations for CJS packages without an "exports" field,
// which NodeNext module resolution requires for deep path imports.
// At runtime these resolve fine; this only satisfies the type checker.

declare module "homebridge/lib/api" {
  export class HomebridgeAPI {
    [key: string]: any;
  }
}

declare module "homebridge/lib/server" {
  export class Server {
    constructor(options?: any);
    start(): Promise<void>;
    teardown(): void;
    [key: string]: any;
  }
}

declare module "homebridge/lib/user" {
  export class User {
    static setStoragePath(path: string): void;
    static persistPath(): string;
  }
}

declare module "homebridge/lib/pluginManager" {
  export type PluginManager = any;
}

declare module "homebridge/lib/platformAccessory" {
  export class PlatformAccessory {
    constructor(displayName: string, uuid: string, category?: number);
    static deserialize(json: any): PlatformAccessory;
    displayName: string;
    UUID: string;
    category: number;
    [key: string]: any;
  }
  export type SerializedPlatformAccessory = any;
}

declare module "tplink-smarthome-api/lib/bulb" {
  export type BulbSysinfoLightState = any;
}
