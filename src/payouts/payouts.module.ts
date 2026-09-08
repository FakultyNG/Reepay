import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { CommonModule } from "../common/common.module";
import { ConfigModule } from "../config/config.module";
import { DatabaseModule } from "../database/database.module";
import { KryptaPayModule } from "../providers/kryptapay";
import { WiseModule } from "../providers/wise";
import { SangaPayWebhookModule } from "../webhooks/sangapay";
import { WalletsModule } from "../wallets/wallets.module";
import { PayoutsController } from "./payouts.controller";
import { PayoutsService } from "./payouts.service";

@Module({
  imports: [AuthModule, CommonModule, ConfigModule, DatabaseModule, KryptaPayModule, WiseModule, SangaPayWebhookModule, WalletsModule],
  controllers: [PayoutsController],
  providers: [PayoutsService],
  exports: [PayoutsService]
})
export class PayoutsModule {}
