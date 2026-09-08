import { Module } from "@nestjs/common";
import { CommonModule } from "../common/common.module";
import { ConfigModule } from "../config/config.module";
import { DatabaseModule } from "../database/database.module";
import { DepositsModule } from "../deposits/deposits.module";
import { PayoutsModule } from "../payouts/payouts.module";
import { WalletsModule } from "../wallets/wallets.module";
import { SangaPayWebhookModule } from "../webhooks/sangapay";
import { ReconciliationService } from "./reconciliation.service";

@Module({
  imports: [CommonModule, ConfigModule, DatabaseModule, DepositsModule, PayoutsModule, SangaPayWebhookModule, WalletsModule],
  providers: [ReconciliationService]
})
export class ReconciliationModule {}
