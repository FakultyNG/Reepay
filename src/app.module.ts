import { HttpModule } from "@nestjs/axios";
import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { AdminModule } from "./admin";
import { CommonModule } from "./common/common.module";
import { ConfigModule } from "./config/config.module";
import { DatabaseModule } from "./database/database.module";
import { DepositsModule } from "./deposits/deposits.module";
import { FxModule } from "./fx/fx.module";
import { HealthModule } from "./health/health.module";
import { PayoutsModule } from "./payouts/payouts.module";
import { ReconciliationModule } from "./reconciliation";
import { RedisModule } from "./redis/redis.module";
import { TransactionsModule } from "./transactions/transactions.module";
import { WalletsModule } from "./wallets/wallets.module";
import { WebhooksModule } from "./webhooks/webhooks.module";

@Module({
  imports: [
    ConfigModule,
    CommonModule,
    DatabaseModule,
    RedisModule,
    HttpModule,
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 120
      }
    ]),
    HealthModule,
    AdminModule,
    WalletsModule,
    DepositsModule,
    FxModule,
    PayoutsModule,
    TransactionsModule,
    ReconciliationModule,
    WebhooksModule
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard
    }
  ]
})
export class AppModule {}
