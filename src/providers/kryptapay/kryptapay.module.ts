import { HttpModule } from "@nestjs/axios";
import { Module } from "@nestjs/common";
import { ConfigModule } from "../../config/config.module";
import { KryptaPayClient } from "./kryptapay.client";
import { KryptaPayConfig } from "./kryptapay.config";

@Module({
  imports: [ConfigModule, HttpModule],
  providers: [KryptaPayConfig, KryptaPayClient],
  exports: [KryptaPayClient]
})
export class KryptaPayModule {}
