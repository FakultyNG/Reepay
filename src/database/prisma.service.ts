import { Inject, Injectable, OnModuleDestroy } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { AppConfigService } from "../config/app-config.service";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(AppConfigService) config: AppConfigService) {
    super({
      datasources: {
        db: {
          url: config.databaseUrl
        }
      }
    });
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
