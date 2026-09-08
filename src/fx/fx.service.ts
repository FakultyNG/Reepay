import { Inject, Injectable } from "@nestjs/common";
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
      purpose: dto.purpose ?? FxQuotePurpose.DISPLAY,
      quotedAt,
      expiresAt: quote.expiresAt
    };
  }
}
