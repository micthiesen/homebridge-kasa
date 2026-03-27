import type { Logger, Logging, LogLevel } from "homebridge";

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
