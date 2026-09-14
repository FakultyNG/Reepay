import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { CommonModule } from "../common/common.module";
import { DatabaseModule } from "../database/database.module";
import { KryptaPayModule } from "../providers/kryptapay";
import { SangaPayWebhookModule } from "../webhooks/sangapay";
import { DepositsController } from "./deposits.controller";
import { DepositsService } from "./deposits.service";

@Module({
  imports: [AuthModule, CommonModule, DatabaseModule, KryptaPayModule, SangaPayWebhookModule],
  controllers: [DepositsController],
  providers: [DepositsService],
  exports: [DepositsService]
})
export class DepositsModule {}
