import { sleep } from "@micthiesen/mitools/async";
import { Service } from "hap-nodejs";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { deferAndCombine } from "../src/util/deferAndCombine.js";
import { lookup } from "../src/util/homekit.js";
import { isObjectLike } from "../src/util/types.js";

describe("utils", () => {
  describe("deferAndCombine", () => {
    let spy: Mock;
    let deferredFn: () => Promise<unknown>;
    const deferTime = 100;

    beforeEach(() => {
      let index = 0;
      spy = vi.fn();
      deferredFn = deferAndCombine(() => {
        index += 1;
        return new Promise((resolve) => {
          spy(index);
          resolve(index);
        });
      }, deferTime);
    });

    it(
      "should batch 3 calls made within the timeout",
      async () => {
        const startTimer = Date.now();
        const results = await Promise.all([deferredFn(), deferredFn(), deferredFn()]);
        expect(Date.now() - startTimer).toBeGreaterThanOrEqual(deferTime * 0.9);
        expect(Date.now() - startTimer).toBeLessThanOrEqual(deferTime * 2);
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledWith(1);
        expect(results).toEqual([1, 1, 1]);
      },
      deferTime * 2,
    );

    it(
      "should separately batch calls made outside the timeout",
      async () => {
        const startTimer = Date.now();

        const batchOne = Promise.all([deferredFn(), deferredFn(), deferredFn()]);

        await sleep(deferTime);
        const batchTwo = Promise.all([deferredFn(), deferredFn()]);

        const resultsOne = await batchOne;
        const resultsTwo = await batchTwo;

        expect(Date.now() - startTimer).toBeGreaterThanOrEqual(deferTime * 1.9);
        expect(Date.now() - startTimer).toBeLessThanOrEqual(deferTime * 3);

        expect(spy).toHaveBeenCalledTimes(2);
        expect(spy).toHaveBeenCalledWith(1);

        expect(resultsOne).toEqual([1, 1, 1]);
        expect(resultsTwo).toEqual([2, 2]);
      },
      deferTime * 4,
    );
  });

  describe("lookup", () => {
    it("should lookup with default compareFn", () => {
      expect(lookup({ aKey: "a", bKey: "b" }, undefined, "a")).toEqual("aKey");
    });

    it("should lookup with compareFn", () => {
      expect(
        lookup(
          { aKey: { key: "a" }, bKey: { key: "b" } },
          (objProp, search) =>
            isObjectLike(objProp) && "key" in objProp && objProp.key === search,
          "b",
        ),
      ).toEqual("bKey");
    });

    it("should lookup Service", () => {
      expect(
        lookup(
          Service,
          (objProp, search) => {
            return (
              isObjectLike(objProp) && "UUID" in objProp && objProp.UUID === search.UUID
            );
          },
          Service.Outlet,
        ),
      ).toEqual("Outlet");
    });
  });
});
