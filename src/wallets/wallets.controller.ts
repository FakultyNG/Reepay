import { Body, Controller, Get, Headers, Inject, Optional, Param, ParseIntPipe, Post, Query, UseGuards } from "@nestjs/common";
import { ApiSecurity, ApiTags } from "@nestjs/swagger";
import { WalletCurrency } from "@prisma/client";
import { ApiKeyGuard } from "../auth/api-key.guard";
import { ConfirmWalletConversionDto } from "./dto/confirm-wallet-conversion.dto";
import { CreateWalletConversionQuoteDto } from "./dto/create-wallet-conversion-quote.dto";
import { WalletConversionsService } from "./wallet-conversions.service";
import { WalletsService } from "./wallets.service";

@ApiTags("wallets")
@ApiSecurity("reepay-api-key")
@UseGuards(ApiKeyGuard)
@Controller({ path: "wallet", version: "1" })
export class WalletsController {
  constructor(
    @Inject(WalletsService) private readonly wallets: WalletsService,
    @Optional() @Inject(WalletConversionsService) private readonly conversions?: WalletConversionsService
  ) {}

  @Get("/balance")
  getAuthoritativeBalance(@Query("customerId") customerId: string) {
    return this.wallets.getBalance(customerId, WalletCurrency.XAF);
  }

  @Get("/xaf")
  getXafWallet(@Query("customerId") customerId: string) {
    return this.wallets.getBalance(customerId, WalletCurrency.XAF);
  }

  @Get("/eur")
  getEurWallet(@Query("customerId") customerId: string) {
    return this.wallets.getBalance(customerId, WalletCurrency.EUR);
  }

  @Get("/usdc")
  getUsdcWallet(@Query("customerId") customerId: string) {
    return this.wallets.getBalance(customerId, WalletCurrency.USDC);
  }

  @Get("/summary")
  getSummary(@Query("customerId") customerId: string, @Headers("x-request-id") requestId?: string) {
    return this.wallets.getSummary(customerId, requestId);
  }

  @Post("/eur/quote")
  createEurWalletQuote(
    @Body() body: CreateWalletConversionQuoteDto,
    @Headers("x-request-id") requestId?: string,
    @Headers("idempotency-key") idempotencyKey?: string
  ) {
    return this.conversions!.createQuote(body, WalletCurrency.EUR, requestId, idempotencyKey);
  }

  @Post("/eur/confirm")
  confirmEurWalletFunding(
    @Body() body: ConfirmWalletConversionDto,
    @Headers("x-request-id") requestId?: string,
    @Headers("idempotency-key") idempotencyKey?: string
  ) {
    return this.conversions!.confirm(body, WalletCurrency.EUR, requestId, idempotencyKey);
  }

  @Post("/usdc/quote")
  createUsdcWalletQuote(
    @Body() body: CreateWalletConversionQuoteDto,
    @Headers("x-request-id") requestId?: string,
    @Headers("idempotency-key") idempotencyKey?: string
  ) {
    return this.conversions!.createQuote(body, WalletCurrency.USDC, requestId, idempotencyKey);
  }

  @Post("/usdc/confirm")
  confirmUsdcWalletFunding(
    @Body() body: ConfirmWalletConversionDto,
    @Headers("x-request-id") requestId?: string,
    @Headers("idempotency-key") idempotencyKey?: string
  ) {
    return this.conversions!.confirm(body, WalletCurrency.USDC, requestId, idempotencyKey);
  }

  @Get("/conversions/:id")
  getWalletConversion(
    @Param("id") conversionId: string,
    @Query("customerId") customerId: string
  ) {
    return this.conversions!.getCustomerConversion(conversionId, customerId);
  }

  @Get("/funding-instructions")
  getFundingInstructions(@Query("customerId") customerId: string) {
    return this.wallets.getFundingInstructions(customerId);
  }

  @Get("/recent-transactions")
  getRecentTransactions(
    @Query("customerId") customerId: string,
    @Query("limit", new ParseIntPipe({ optional: true })) limit?: number
  ) {
    return this.wallets.getRecentTransactions(customerId, limit);
  }
}
