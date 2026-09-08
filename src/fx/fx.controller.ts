import { Body, Controller, Headers, Inject, Post, UseGuards } from "@nestjs/common";
import { ApiSecurity, ApiTags } from "@nestjs/swagger";
import { ApiKeyGuard } from "../auth/api-key.guard";
import {
  CreateFxQuoteDto,
  CreateXafAmountQuoteDto,
  FxQuotePurpose,
  FxQuoteTargetCurrency
} from "./dto/create-fx-quote.dto";
import { FxService } from "./fx.service";

@ApiTags("fx")
@ApiSecurity("reepay-api-key")
@UseGuards(ApiKeyGuard)
@Controller({ path: "fx", version: "1" })
export class FxController {
  constructor(@Inject(FxService) private readonly fx: FxService) {}

  @Post("quote")
  quote(@Body() body: CreateFxQuoteDto, @Headers("x-request-id") requestId?: string) {
    return this.fx.quoteXaf(body, requestId);
  }

  @Post("quote/xaf-eur")
  quoteXafEur(@Body() body: CreateXafAmountQuoteDto, @Headers("x-request-id") requestId?: string) {
    return this.fx.quoteXaf({ ...body, to: FxQuoteTargetCurrency.EUR }, requestId);
  }

  @Post("quote/xaf-usdc")
  quoteXafUsdc(@Body() body: CreateXafAmountQuoteDto, @Headers("x-request-id") requestId?: string) {
    return this.fx.quoteXaf({ ...body, to: FxQuoteTargetCurrency.USDC }, requestId);
  }

  @Post("quote/xaf-eur/payout")
  quoteXafEurForPayout(@Body() body: CreateXafAmountQuoteDto, @Headers("x-request-id") requestId?: string) {
    return this.fx.quoteXaf(
      { ...body, to: FxQuoteTargetCurrency.EUR, purpose: FxQuotePurpose.PAYOUT },
      requestId
    );
  }
}
