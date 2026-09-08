import { Prisma, WalletCurrency } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { WalletsService } from "../src/wallets/wallets.service";
import type { PrismaService } from "../src/database/prisma.service";
import type { KryptaPayClient } from "../src/providers/kryptapay";

describe("Wallet summary", () => {
  it("returns XAF ledger balance with USDC and EUR display equivalents from fresh provider quotes", async () => {
    const prisma = {
      customer: {
        findUnique: vi.fn().mockResolvedValue({
          id: "customer_123",
          externalId: "sanga_user_1",
          wallets: [
            {
              id: "wallet_123",
              balance: new Prisma.Decimal("1000000"),
              currency: WalletCurrency.XAF
            }
          ]
        })
      }
    } as unknown as PrismaService;
    const kryptaPay = {
      createIndicativeConversionQuote: vi
        .fn()
        .mockResolvedValueOnce({
          from: "XAF",
          to: "USDC",
          fromAmount: "1000000",
          toAmount: "1650.25",
          expiresAt: "2026-08-27T00:01:00.000Z"
        })
        .mockResolvedValueOnce({
          from: "XAF",
          to: "EUR",
          fromAmount: "1000000",
          toAmount: "1524.49",
          expiresAt: "2026-08-27T00:01:00.000Z"
        })
    } as unknown as KryptaPayClient;
    const service = new WalletsService(prisma, kryptaPay);

    const result = await service.getSummary("sanga_user_1", "req_123");

    expect(kryptaPay.createIndicativeConversionQuote).toHaveBeenCalledTimes(2);
    expect(kryptaPay.createIndicativeConversionQuote).toHaveBeenNthCalledWith(
      1,
      { from: "XAF", to: "USDC", amount: "1000000", side: "debit_from" },
      { requestId: "req_123" }
    );
    expect(kryptaPay.createIndicativeConversionQuote).toHaveBeenNthCalledWith(
      2,
      { from: "XAF", to: "EUR", amount: "1000000", side: "debit_from" },
      { requestId: "req_123" }
    );
    expect(result).toMatchObject({
      xaf: {
        balance: "1000000",
        currency: "XAF",
        sourceOfTruth: "reepay_ledger"
      },
      equivalents: {
        USDC: {
          amount: "1650.25",
          currency: "USDC",
          displayOnly: true,
          expiresAt: "2026-08-27T00:01:00.000Z"
        },
        EUR: {
          amount: "1524.49",
          currency: "EUR",
          displayOnly: true,
          expiresAt: "2026-08-27T00:01:00.000Z"
        }
      }
    });
    expect(result.equivalents.USDC.quotedAt).toEqual(expect.any(String));
    expect(result.equivalents.EUR.quotedAt).toEqual(expect.any(String));
  });

  it("keeps wallet balance authoritative and does not call FX provider for balance-only requests", async () => {
    const prisma = {
      customer: {
        findUnique: vi.fn().mockResolvedValue({
          id: "customer_123",
          externalId: "sanga_user_1",
          wallets: [{ balance: new Prisma.Decimal("1000000"), currency: WalletCurrency.XAF }]
        })
      }
    } as unknown as PrismaService;
    const kryptaPay = {
      createIndicativeConversionQuote: vi.fn()
    } as unknown as KryptaPayClient;
    const service = new WalletsService(prisma, kryptaPay);

    await expect(service.getBalance("sanga_user_1")).resolves.toEqual({
      customerId: "sanga_user_1",
      currency: "XAF",
      balance: "1000000",
      sourceOfTruth: "reepay_ledger"
    });
    expect(kryptaPay.createIndicativeConversionQuote).not.toHaveBeenCalled();
  });
});
