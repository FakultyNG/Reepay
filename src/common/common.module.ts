import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { ConfigModule } from "../config/config.module";
import { FeeService } from "./fees/fee.service";
import { JsonLogger } from "./logging/json-logger";
import { RequestIdMiddleware } from "./middleware/request-id.middleware";
import { RequestLoggingMiddleware } from "./middleware/request-logging.middleware";

@Module({
  imports: [ConfigModule],
  providers: [FeeService, JsonLogger],
  exports: [FeeService, JsonLogger]
})
export class CommonModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware, RequestLoggingMiddleware).forRoutes("*");
  }
}
