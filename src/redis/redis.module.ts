import { Global, Module } from "@nestjs/common";
import Redis from "ioredis";
import { AppConfigService } from "../config/app-config.service";
import { ConfigModule } from "../config/config.module";
import { REDIS_CLIENT } from "./redis.constants";

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) =>
        new Redis(config.redisUrl, {
          lazyConnect: true,
          maxRetriesPerRequest: 3
        })
    }
  ],
  exports: [REDIS_CLIENT]
})
export class RedisModule {}
