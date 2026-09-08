import { HttpModule } from "@nestjs/axios";
import { Module } from "@nestjs/common";
import { ConfigModule } from "../../config/config.module";
import { WiseClient } from "./wise.client";
import { WiseConfig } from "./wise.config";

@Module({
  imports: [ConfigModule, HttpModule],
  providers: [WiseConfig, WiseClient],
  exports: [WiseClient]
})
export class WiseModule {}
