import { Inject, Injectable } from "@nestjs/common";
import { AppConfigService } from "../../config/app-config.service";

@Injectable()
export class KryptaPayConfig {
  constructor(@Inject(AppConfigService) private readonly appConfig: AppConfigService) {}

  get baseUrl() {
    return this.appConfig.kryptapay.baseUrl.replace(/\/+$/, "");
  }

  get apiKey() {
    return this.appConfig.kryptapay.apiKey;
  }

  get webhookSecret() {
    return this.appConfig.kryptapay.webhookSecret;
  }
}
