import type {
  Characteristic,
  Logger,
  Logging,
  LogLevel,
  Service,
  WithUUID,
} from "homebridge";

import type { Bulb, Plug } from "tplink-smarthome-api";

import type { KlapBulb, KlapPlug } from "./klap/index.js";

export type TplinkDevice = Bulb | Plug | KlapPlug | KlapBulb;

export function isObjectLike(candidate: unknown): candidate is Record<string, unknown> {
  return (
    (typeof candidate === "object" && candidate !== null) ||
    typeof candidate === "function"
  );
}

/**
 * Creates a function that will "batch" calls that are within the `timeout`
 *
 * The first time the function that is created is called, it will wait the `timeout` for additional calls.
 * After the `timeout` expires the result of one execution of `fn` will be resolved to all calls during the `timeout`.
 *
 * If `runNowFn` is specified it will be run synchronously without a timeout. Useful for functions that are used to set rather than get.
 *
 * @param {() => Promise<T>} fn
 * @param {number} timeout (ms)
 * @param {(arg: U) => void} [runNowFn]
 * @returns {(arg?: U) => Promise<T>}
 */
export function deferAndCombine<T, U>(
  fn: (requestCount: number) => Promise<T>,
  timeout: number,
  runNowFn?: (arg: U) => void,
): (arg?: U) => Promise<T> {
  const requests: {
    resolve: (value: T | PromiseLike<T>) => void;
    reject: (reason?: unknown) => void;
  }[] = [];
  let isWaiting = false;

  return (arg) => {
    if (runNowFn !== undefined && arg !== undefined) {
      runNowFn(arg);
    }

    return new Promise((resolve, reject) => {
      requests.push({ resolve, reject });

      if (isWaiting) return;
      isWaiting = true;

      setTimeout(() => {
        isWaiting = false;
        fn(requests.length)
          .then((value) => {
            for (const d of requests) {
              d.resolve(value);
            }
          })
          .catch((error) => {
            for (const d of requests) {
              d.reject(error);
            }
          });
      }, timeout);
    });
  };
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function getOrAddCharacteristic(
  service: Service,
  characteristic: WithUUID<new () => Characteristic>,
): Characteristic {
  if (
    !hasCharacteristic(
      service.characteristics.concat(service.optionalCharacteristics),
      characteristic,
    )
  ) {
    // This it to suppress warning: Characteristic not in required or optional characteristic section for service
    service.addOptionalCharacteristic(characteristic);
  }

  return (
    service.getCharacteristic(characteristic) ||
    service.addCharacteristic(characteristic)
  );
}

export function hasCharacteristic(
  characteristics: Array<Characteristic>,
  characteristic: WithUUID<{ new (): Characteristic }>,
): boolean {
  return (
    characteristics.find((char) => {
      if (char instanceof characteristic) return true;
      return (char as Characteristic).UUID === characteristic.UUID;
    }) !== undefined
  );
}

export function kelvinToMired(kelvin: number): number {
  return 1e6 / kelvin;
}

export function lookup<T>(
  object: unknown,
  compareFn: undefined | ((objectProp: unknown, search: T) => boolean),
  value: T,
): string | undefined {
  const compare =
    compareFn ?? ((objectProp: unknown, search: T): boolean => objectProp === search);

  if (isObjectLike(object)) {
    const keys = Object.keys(object);
    for (let i = 0; i < keys.length; i += 1) {
      if (compare(object[keys[i]], value)) {
        return keys[i];
      }
    }
  }
  return undefined;
}

export function lookupCharacteristicNameByUUID(
  characteristic: typeof Characteristic,
  uuid: string,
): string | undefined {
  const record = characteristic as unknown as Record<string, unknown>;
  const keys = Object.keys(record);
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    const c = record[key];
    if (isObjectLike(c) && "UUID" in c && c.UUID === uuid) {
      return key;
    }
  }
  return undefined;
}

export function miredToKelvin(mired: number): number {
  return 1e6 / mired;
}

function cloneLogger(logger: Logging): Logging {
  const baseFn = logger.info.bind(logger) as Logging;
  baseFn.info = logger.info;
  baseFn.warn = logger.warn;
  baseFn.error = logger.error;
  baseFn.debug = logger.debug;
  baseFn.log = logger.log;
  baseFn.prefix = logger.prefix;

  return baseFn;
}

export function prefixLogger(logger: Logger, prefix: string | (() => string)): Logging {
  const newLogger = cloneLogger(logger as Logging);

  const origLog = logger.log.bind(newLogger);

  newLogger.log = function log(
    level: LogLevel,
    message: string,
    ...parameters: unknown[]
  ) {
    const prefixEval = prefix instanceof Function ? prefix() : prefix;
    origLog(level, `${prefixEval} ${message}`, ...parameters);
  };

  return newLogger;
}
