import { Body, Controller, Get, Headers, Inject, Param, Post, UseGuards } from "@nestjs/common";
import { ApiSecurity, ApiTags } from "@nestjs/swagger";
import { WalletCurrency } from "@prisma/client";
import { ApiKeyGuard } from "../auth/api-key.guard";
import { ConfirmWalletConversionDto } from "../wallets/dto/confirm-wallet-conversion.dto";
import { WalletConversionsService } from "../wallets/wallet-conversions.service";
import { ConfirmEurPayoutDto } from "./dto/confirm-eur-payout.dto";
import { CreateEurPayoutQuoteDto } from "./dto/create-eur-payout-quote.dto";
import { CreateEurWiseTagPayoutQuoteDto } from "./dto/create-eur-wisetag-payout-quote.dto";
import { CreateUsdcAddressPayoutQuoteDto } from "./dto/create-usdc-address-payout-quote.dto";
import { ValidateEurRecipientDto } from "./dto/validate-eur-recipient.dto";
import { PayoutsService } from "./payouts.service";

@ApiTags("payouts")
@ApiSecurity("reepay-api-key")
@UseGuards(ApiKeyGuard)
@Controller({ path: "payouts", version: "1" })
export class PayoutsController {
  constructor(
    @Inject(PayoutsService) private readonly payouts: PayoutsService,
    @Inject(WalletConversionsService) private readonly conversions: WalletConversionsService
  ) {}

  @Post("eur/quote")
  createEurPayoutQuote(
    @Body() body: CreateEurPayoutQuoteDto,
    @Headers("x-request-id") requestId?: string,
    @Headers("idempotency-key") idempotencyKey?: string
  ) {
    return this.payouts.createEurPayoutQuote(body, requestId, idempotencyKey);
  }

  @Post("eur/recipient/validate")
  validateRecipient(@Body() body: ValidateEurRecipientDto) {
    return this.payouts.validateRecipient(body.iban, body.beneficiaryName);
  }

  @Post("eur/iban/quote")
  createEurIbanPayoutQuote(
    @Body() body: CreateEurPayoutQuoteDto,
    @Headers("x-request-id") requestId?: string,
    @Headers("idempotency-key") idempotencyKey?: string
  ) {
    return this.payouts.createEurIbanPayoutQuote(body, requestId, idempotencyKey);
  }

  @Post("eur/iban/confirm")
  confirmEurIbanPayout(
    @Body() body: ConfirmEurPayoutDto,
    @Headers("x-request-id") requestId?: string,
    @Headers("idempotency-key") idempotencyKey?: string
  ) {
    return this.payouts.confirmEurIbanPayout(body, requestId, idempotencyKey);
  }

  @Post("eur/wisetag/quote")
  createEurWiseTagPayoutQuote(
    @Body() body: CreateEurWiseTagPayoutQuoteDto,
    @Headers("x-request-id") requestId?: string,
    @Headers("idempotency-key") idempotencyKey?: string
  ) {
    return this.payouts.createEurWiseTagPayoutQuote(body, requestId, idempotencyKey);
  }

  @Post("eur/wisetag/confirm")
  confirmEurWiseTagPayout(
    @Body() body: ConfirmEurPayoutDto,
    @Headers("x-request-id") requestId?: string,
    @Headers("idempotency-key") idempotencyKey?: string
  ) {
    return this.payouts.confirmEurWiseTagPayout(body, requestId, idempotencyKey);
  }

  @Post("eur/confirm")
  confirmEurPayout(
    @Body() body: ConfirmWalletConversionDto,
    @Headers("x-request-id") requestId?: string,
    @Headers("idempotency-key") idempotencyKey?: string
  ) {
    return this.conversions.confirm(body, WalletCurrency.EUR, requestId, idempotencyKey);
  }

  @Post("usdc/confirm")
  confirmUsdcWalletFundingAlias(
    @Body() body: ConfirmWalletConversionDto,
    @Headers("x-request-id") requestId?: string,
    @Headers("idempotency-key") idempotencyKey?: string
  ) {
    return this.conversions.confirm(body, WalletCurrency.USDC, requestId, idempotencyKey);
  }

  @Post("usdc/address/quote")
  createUsdcAddressPayoutQuote(
    @Body() body: CreateUsdcAddressPayoutQuoteDto,
    @Headers("idempotency-key") idempotencyKey?: string
  ) {
    return this.payouts.createUsdcAddressPayoutQuote(body, idempotencyKey);
  }

  @Post("usdc/address/confirm")
  confirmUsdcAddressPayout(
    @Body() body: ConfirmEurPayoutDto,
    @Headers("x-request-id") requestId?: string,
    @Headers("idempotency-key") idempotencyKey?: string
  ) {
    return this.payouts.confirmUsdcAddressPayout(body, requestId, idempotencyKey);
  }

  @Get(":id")
  getPayoutStatus(@Param("id") id: string) {
    return this.payouts.getPayoutStatus(id);
  }
}
