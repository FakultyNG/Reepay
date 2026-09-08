import { Module } from "@nestjs/common";
import { KryptaPayModule } from "./kryptapay/kryptapay.module";
import { WiseModule } from "./wise";

@Module({
  imports: [KryptaPayModule, WiseModule],
  exports: [KryptaPayModule, WiseModule]
})
export class ProvidersModule {}
