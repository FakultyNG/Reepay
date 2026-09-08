import { HttpModule } from "@nestjs/axios";
import { Module } from "@nestjs/common";
import { ConfigModule } from "../../config/config.module";
import { DatabaseModule } from "../../database/database.module";
import { SangaPayWebhookDispatcher } from "./sangapay-webhook-dispatcher.service";

@Module({
  imports: [ConfigModule, DatabaseModule, HttpModule],
  providers: [SangaPayWebhookDispatcher],
  exports: [SangaPayWebhookDispatcher]
})
export class SangaPayWebhookModule {}
