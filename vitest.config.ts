import { baseVitestConfig } from "@micthiesen/mitools/vitest";
import { mergeConfig } from "vitest/config";

export default mergeConfig(baseVitestConfig, {
  test: {
    exclude: ["**/build/**", "**/lib/**"],
  },
});
