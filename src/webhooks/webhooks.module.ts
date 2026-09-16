import { Module } from "@nestjs/common";
import { CommonModule } from "../common/common.module";
import { ConfigModule } from "../config/config.module";
import { DatabaseModule } from "../database/database.module";
import { PayoutsModule } from "../payouts/payouts.module";
import { KryptaPayModule } from "../providers/kryptapay";
import { WalletsModule } from "../wallets/wallets.module";
import { KryptaPayWebhookController } from "./kryptapay/kryptapay-webhook.controller";
import { KryptaPayWebhookService } from "./kryptapay/kryptapay-webhook.service";
import { SangaPayWebhookModule } from "./sangapay";
import { WiseWebhookController } from "./wise/wise-webhook.controller";
import { WiseWebhookService } from "./wise/wise-webhook.service";

@Module({
  imports: [ConfigModule, CommonModule, DatabaseModule, KryptaPayModule, PayoutsModule, SangaPayWebhookModule, WalletsModule],
  controllers: [KryptaPayWebhookController, WiseWebhookController],
  providers: [KryptaPayWebhookService, WiseWebhookService]
})
export class WebhooksModule {}
