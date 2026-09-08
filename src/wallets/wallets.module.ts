import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { CommonModule } from "../common/common.module";
import { DatabaseModule } from "../database/database.module";
import { KryptaPayModule } from "../providers/kryptapay";
import { TransactionsModule } from "../transactions/transactions.module";
import { SangaPayWebhookModule } from "../webhooks/sangapay";
import { WalletConversionsService } from "./wallet-conversions.service";
import { WalletsController } from "./wallets.controller";
import { WalletsService } from "./wallets.service";

@Module({
  imports: [AuthModule, CommonModule, DatabaseModule, KryptaPayModule, TransactionsModule, SangaPayWebhookModule],
  controllers: [WalletsController],
  providers: [WalletsService, WalletConversionsService],
  exports: [WalletsService, WalletConversionsService]
})
export class WalletsModule {}
