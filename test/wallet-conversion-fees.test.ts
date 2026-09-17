import { Prisma, WalletCurrency } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import type { FeeService } from "../src/common/fees/fee.service";
import type { AppConfigService } from "../src/config/app-config.service";
import type { PrismaService } from "../src/database/prisma.service";
import type { KryptaPayClient } from "../src/providers/kryptapay";
import type { SangaPayWebhookDispatcher } from "../src/webhooks/sangapay";
import { WalletConversionsService } from "../src/wallets/wallet-conversions.service";

describe("wallet conversion fee contract", () => {
  it("returns spread, bank payout fee, Reepay fee, and totals for EUR wallet funding", async () => {
    const prisma = {
      walletConversionQuote: {
        findUnique: vi.fn(),
        create: vi.fn(async ({ data }) => ({
          ...data,
          id: "quote_123",
          quotedAt: new Date("2026-09-17T00:00:00.000Z")
        }))
      }
    } as unknown as PrismaService;
    const kryptaPay = {
      createIndicativeConversionQuote: vi.fn().mockResolvedValue({
        fromAmount: "66000",
        toAmount: "100",
        midRate: "0.00155",
        appliedRate: "0.00151515",
        spreadBps: 225,
        expiresAt: "2026-09-17T00:05:00.000Z"
      })
    } as unknown as KryptaPayClient;
    const feeService = {
      calculateBankPayoutProviderFeeDecimal: vi.fn().mockReturnValue(new Prisma.Decimal("198")),
      calculateCustomerFeeDecimal: vi.fn().mockReturnValue(new Prisma.Decimal("500"))
    } as unknown as FeeService;
    const service = new WalletConversionsService(
      prisma,
      kryptaPay,
      feeService,
      {} as AppConfigService,
      {} as SangaPayWebhookDispatcher
    );

    const result = await service.createQuote(
      { customerId: "customer_123", amount: "100" },
      WalletCurrency.EUR,
      "request_123",
      "quote_idempotency_123"
    );

    expect(feeService.calculateBankPayoutProviderFeeDecimal).toHaveBeenCalledWith(new Prisma.Decimal("66000"));
    expect(result.fees.provider).toEqual({ amount: "198", currency: "XAF" });
    expect(result.fees.reepay).toEqual({ amount: "500", currency: "XAF" });
    expect(result.fees.conversionSpread).toMatchObject({
      amount: "1483.87096774",
      basisPoints: 225,
      includedInRate: true
    });
    expect(result.totalExplicitFee).toEqual({ amount: "698", currency: "XAF" });
    expect(result.totalFee).toEqual({ amount: "2181.87096774", currency: "XAF" });
    expect(result.totalDebit).toEqual({ amount: "66698", currency: "XAF" });
  });

  it("does not add the BANK_EUR fee to USDC wallet funding", async () => {
    const prisma = {
      walletConversionQuote: {
        findUnique: vi.fn(),
        create: vi.fn(async ({ data }) => ({
          ...data,
          id: "quote_usdc",
          quotedAt: new Date("2026-09-17T00:00:00.000Z")
        }))
      }
    } as unknown as PrismaService;
    const kryptaPay = {
      createIndicativeConversionQuote: vi.fn().mockResolvedValue({
        fromAmount: "60000",
        toAmount: "100",
        midRate: "0.0017",
        appliedRate: "0.00166667",
        spreadBps: 196,
        expiresAt: "2026-09-17T00:05:00.000Z"
      })
    } as unknown as KryptaPayClient;
    const bankFee = vi.fn();
    const feeService = {
      calculateBankPayoutProviderFeeDecimal: bankFee,
      calculateCustomerFeeDecimal: vi.fn().mockReturnValue(new Prisma.Decimal("500"))
    } as unknown as FeeService;
    const service = new WalletConversionsService(
      prisma,
      kryptaPay,
      feeService,
      {} as AppConfigService,
      {} as SangaPayWebhookDispatcher
    );

    const result = await service.createQuote({ customerId: "customer_123", amount: "100" }, WalletCurrency.USDC);

    expect(bankFee).not.toHaveBeenCalled();
    expect(result.fees.provider.amount).toBe("0");
  });
});
