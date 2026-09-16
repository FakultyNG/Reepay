import { Module } from "@nestjs/common";
import { ConfigModule } from "../config/config.module";
import { DatabaseModule } from "../database/database.module";
import { AdminApiKeyGuard } from "./admin-api-key.guard";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";

@Module({
  imports: [ConfigModule, DatabaseModule],
  controllers: [AdminController],
  providers: [AdminApiKeyGuard, AdminService],
  exports: [AdminService]
})
export class AdminModule {}
