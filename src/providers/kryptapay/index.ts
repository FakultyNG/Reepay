import type { AppConfigService } from "../../config/app-config.service";
import type { ProviderHealth } from "../types";

export function kryptapayProviderHealth(config: AppConfigService): ProviderHealth {
  return {
    provider: "kryptapay",
    configured: Boolean(config.kryptapay.baseUrl && config.kryptapay.apiKey)
  };
}

export { KryptaPayModule } from "./kryptapay.module";
export { KryptaPayClient } from "./kryptapay.client";
