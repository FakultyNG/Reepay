import { describe, expect, it, vi } from "vitest";
import { FxService } from "../src/fx/fx.service";
import { FxQuoteTargetCurrency } from "../src/fx/dto/create-fx-quote.dto";
import type { KryptaPayClient } from "../src/providers/kryptapay";

describe("FX quote fee contract", () => {
  it("exposes the KryptaPay spread for an XAF to USDC quote", async () => {
    const kryptaPay = {
      createIndicativeConversionQuote: vi.fn().mockResolvedValue({
        from: "XAF",
        to: "USDC",
        fromAmount: "60000",
        toAmount: "100",
        midRate: "0.0017",
        appliedRate: "0.00166667",
        spreadBps: 196,
        expiresAt: "2026-09-17T00:05:00.000Z",
        trace: { provider: "kryptapay", merchantReference: "quote" }
      })
    } as unknown as KryptaPayClient;
    const service = new FxService(kryptaPay);

    const result = await service.quoteXaf({ amount: "60000", to: FxQuoteTargetCurrency.USDC });

    expect(result.rates).toEqual({
      midRate: "0.0017",
      appliedRate: "0.00166667",
      spreadBps: 196
    });
    expect(result.fees.conversionSpread).toEqual({
      amount: "1176.47058824",
      currency: "XAF",
      basisPoints: 196,
      includedInRate: true
    });
    expect(result.totalFee).toEqual({ amount: "1176.47058824", currency: "XAF" });
  });
});
