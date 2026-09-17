import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { KryptaPayClient } from "../providers/kryptapay";
import { FxQuotePurpose, type CreateFxQuoteDto } from "./dto/create-fx-quote.dto";

@Injectable()
export class FxService {
  constructor(@Inject(KryptaPayClient) private readonly kryptaPay: KryptaPayClient) {}

  async quoteXaf(dto: CreateFxQuoteDto, requestId?: string) {
    const quotedAt = new Date().toISOString();
    const quote = await this.kryptaPay.createIndicativeConversionQuote(
      {
        from: "XAF",
        to: dto.to,
        amount: dto.amount,
        side: dto.purpose === FxQuotePurpose.PAYOUT ? "credit_to" : "debit_from"
      },
      { requestId }
    );
    const fromAmount = new Prisma.Decimal(quote.fromAmount);
    const toAmount = new Prisma.Decimal(quote.toAmount);
    const midRate = new Prisma.Decimal(quote.midRate);
    if (midRate.lessThanOrEqualTo(0)) {
      throw new BadRequestException("Provider FX quote returned an invalid mid-market rate");
    }
    const midMarketSourceAmount = toAmount.div(midRate);
    const conversionSpread = fromAmount.greaterThan(midMarketSourceAmount)
      ? fromAmount.sub(midMarketSourceAmount).toDecimalPlaces(8)
      : new Prisma.Decimal(0);

    return {
      source: {
        amount: quote.fromAmount,
        currency: "XAF"
      },
      destination: {
        amount: quote.toAmount,
        currency: dto.to
      },
      rate: quote.appliedRate,
      rates: {
        midRate: quote.midRate,
        appliedRate: quote.appliedRate,
        spreadBps: quote.spreadBps
      },
      fees: {
        conversionSpread: {
          amount: conversionSpread.toFixed(),
          currency: "XAF",
          basisPoints: quote.spreadBps,
          includedInRate: true
        }
      },
      totalFee: {
        amount: conversionSpread.toFixed(),
        currency: "XAF"
      },
      purpose: dto.purpose ?? FxQuotePurpose.DISPLAY,
      quotedAt,
      expiresAt: quote.expiresAt
    };
  }
}
