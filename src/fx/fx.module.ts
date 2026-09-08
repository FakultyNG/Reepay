import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { KryptaPayModule } from "../providers/kryptapay";
import { FxController } from "./fx.controller";
import { FxService } from "./fx.service";

@Module({
  imports: [AuthModule, KryptaPayModule],
  controllers: [FxController],
  providers: [FxService],
  exports: [FxService]
})
export class FxModule {}
