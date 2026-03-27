import type { API } from "homebridge";
import { PLATFORM_NAME } from "./settings.js";
import { TplinkSmarthomePlatform } from "./TplinkSmarthomePlatform.js";

export default (api: API): void => {
  api.registerPlatform(PLATFORM_NAME, TplinkSmarthomePlatform);
};
