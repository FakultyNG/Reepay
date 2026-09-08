import { Module } from "@nestjs/common";
import { ConfigModule } from "../config/config.module";
import { ApiKeyGuard } from "./api-key.guard";

@Module({
  imports: [ConfigModule],
  providers: [ApiKeyGuard],
  exports: [ApiKeyGuard]
})
export class AuthModule {}
