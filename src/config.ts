import { z } from "zod";

const deviceConfigSchema = z.object({
  host: z.string(),
  port: z.number().optional(),
});

const configInputSchema = z.object({
  // HomeKit
  addCustomCharacteristics: z.boolean().optional(),
  emeterPollingInterval: z.number().optional(),
  inUseThreshold: z.number().optional(),
  switchModels: z.array(z.string()).optional(),

  // Discovery
  discoveryPort: z.number().optional(),
  broadcast: z.string().optional(),
  pollingInterval: z.number().optional(),
  deviceTypes: z.array(z.enum(["plug", "bulb"])).optional(),
  macAddresses: z.array(z.string()).optional(),
  excludeMacAddresses: z.array(z.string()).optional(),
  devices: z.array(deviceConfigSchema).optional(),

  // Advanced
  timeout: z.number().optional(),
  transport: z.enum(["tcp", "udp"]).optional(),
  waitTimeUpdate: z.number().optional(),
  devicesUseDiscoveryPort: z.boolean().optional(),

  // Kasa Account
  kasaUsername: z.string().optional(),
  kasaPassword: z.string().optional(),
});

export type TplinkSmarthomeConfigInput = z.infer<typeof configInputSchema>;

export type TplinkSmarthomeConfig = {
  addCustomCharacteristics: boolean;
  emeterPollingInterval: number;
  switchModels: Array<string>;
  waitTimeUpdate: number;

  defaultSendOptions: {
    timeout: number;
    transport: "tcp" | "udp" | undefined;
  };

  discoveryOptions: {
    port: number | undefined;
    broadcast: string;
    discoveryInterval: number;
    devicesUseDiscoveryPort: boolean;
    deviceTypes?: Array<"plug" | "bulb">;
    deviceOptions: {
      defaultSendOptions: {
        timeout: number;
        transport: "tcp" | "udp" | undefined;
      };
      inUseThreshold: number;
    };
    macAddresses?: Array<string>;
    excludeMacAddresses?: Array<string>;
    devices?: Array<{ host: string; port?: number | undefined }>;
  };

  kasaCredentials?: {
    username: string;
    password: string;
  };
};

type TplinkSmarthomeConfigDefault = {
  addCustomCharacteristics: boolean;
  emeterPollingInterval: number;
  inUseThreshold: number;
  switchModels: Array<string>;

  discoveryPort: number;
  broadcast: string;
  pollingInterval: number;
  deviceTypes: Array<"plug" | "bulb">;
  macAddresses?: Array<string>;
  excludeMacAddresses?: Array<string>;
  devices?: Array<{ host: string; port?: number | undefined }>;

  timeout: number;
  transport: "tcp" | "udp" | undefined;
  waitTimeUpdate: number;
  devicesUseDiscoveryPort: boolean;
};

export const defaultConfig: TplinkSmarthomeConfigDefault = {
  addCustomCharacteristics: true,
  emeterPollingInterval: 20,
  inUseThreshold: 0,
  switchModels: ["HS200", "HS210"],

  discoveryPort: 0,
  broadcast: "255.255.255.255",
  pollingInterval: 10,
  deviceTypes: ["bulb", "plug"],
  macAddresses: undefined,
  excludeMacAddresses: undefined,
  devices: undefined,

  timeout: 15,
  transport: undefined,
  waitTimeUpdate: 100,
  devicesUseDiscoveryPort: false,
};

export function parseConfig(config: Record<string, unknown>): TplinkSmarthomeConfig {
  const result = configInputSchema.safeParse(config);
  if (!result.success) {
    throw new Error(`Error parsing config:\n${result.error.message}`);
  }

  const c: TplinkSmarthomeConfigDefault & TplinkSmarthomeConfigInput = {
    ...defaultConfig,
    ...result.data,
  };

  const defaultSendOptions = {
    timeout: c.timeout * 1000,
    transport: c.transport,
  };

  return {
    addCustomCharacteristics: Boolean(c.addCustomCharacteristics),
    emeterPollingInterval: c.emeterPollingInterval * 1000,
    switchModels: c.switchModels,

    waitTimeUpdate: c.waitTimeUpdate,

    defaultSendOptions,

    discoveryOptions: {
      port: c.discoveryPort,
      broadcast: c.broadcast,
      discoveryInterval: c.pollingInterval * 1000,
      devicesUseDiscoveryPort: c.devicesUseDiscoveryPort,
      deviceTypes: c.deviceTypes,
      deviceOptions: {
        defaultSendOptions,
        inUseThreshold: c.inUseThreshold,
      },
      macAddresses: c.macAddresses,
      excludeMacAddresses: c.excludeMacAddresses,
      devices: c.devices,
    },

    kasaCredentials:
      typeof c.kasaUsername === "string" && typeof c.kasaPassword === "string"
        ? { username: c.kasaUsername, password: c.kasaPassword }
        : undefined,
  };
}
