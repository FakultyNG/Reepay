import { Inject, Injectable } from "@nestjs/common";
import { AppConfigService } from "../../config/app-config.service";

@Injectable()
export class WiseConfig {
  constructor(@Inject(AppConfigService) private readonly config: AppConfigService) {}

  get baseUrl() {
    return this.config.wise.baseUrl;
  }

  get apiToken() {
    return this.config.wise.apiToken;
  }

  get profileId() {
    return this.config.wise.profileId;
  }

  get eurBalanceId() {
    return this.config.wise.eurBalanceId;
  }

  get webhookPublicKey() {
    return this.config.wise.webhookPublicKey;
  }

  get eurFundingIban() {
    return this.config.wise.eurFundingIban;
  }

  get eurFundingAccountName() {
    return this.config.wise.eurFundingAccountName;
  }

  get eurFundingBankName() {
    return this.config.wise.eurFundingBankName;
  }
}
