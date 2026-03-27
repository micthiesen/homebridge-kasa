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
