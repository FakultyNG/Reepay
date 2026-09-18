import { ConflictException, BadRequestException } from "@nestjs/common";
import { PayoutStatus, Prisma, TransactionStatus, TransactionType, WalletCurrency } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { FeeService } from "../src/common/fees/fee.service";
import { PayoutsService } from "../src/payouts/payouts.service";
import type { AppConfigService } from "../src/config/app-config.service";
import type { PrismaService } from "../src/database/prisma.service";
import type { KryptaPayClient } from "../src/providers/kryptapay";
import type { SangaPayWebhookDispatcher } from "../src/webhooks/sangapay";

const now = new Date("2026-08-27T00:00:00.000Z");

function config() {
  return {
    fee: {
      type: "fixed",
      fixed: 100,
      percent: 0,
      currency: "XAF"
    }
  } as AppConfigService;
}

function sangapayWebhooks() {
  return {
    dispatch: vi.fn().mockResolvedValue({ queued: false, disabled: true, eventId: "rp_evt_test" })
  } as unknown as SangaPayWebhookDispatcher;
}

describe("EUR payout flow", () => {
  it.each(["SOLANA", "BASE"])("rejects unsupported KryptaPay USDC network %s", async (network) => {
    const service = new PayoutsService(
      {} as PrismaService,
      {} as KryptaPayClient,
      {} as FeeService,
      config(),
      sangapayWebhooks()
    );

    await expect(
      service.createUsdcAddressPayoutQuote({
        customerId: "sanga_user_1",
        amount: "10",
        network: network as "POLYGON",
        address: "0x1234567890123456789012345678901234567890"
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("charges only the Reepay fee for a USDC address payout quote", async () => {
    const prisma = {
      payoutQuote: {
        findUnique: vi.fn(),
        create: vi.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: "quote_usdc_123",
            ...data,
            sourceCurrency: WalletCurrency.USDC,
            quotedAt: now,
            recipientIban: null,
            recipientName: null,
            recipientWiseTag: null
          })
        )
      }
    } as unknown as PrismaService;
    const fees = {
      calculateCurrencyFeeDecimal: vi.fn().mockReturnValue(new Prisma.Decimal("0.203"))
    } as unknown as FeeService;
    const service = new PayoutsService(prisma, {} as KryptaPayClient, fees, config(), sangapayWebhooks());

    const result = await service.createUsdcAddressPayoutQuote(
      {
        customerId: "sanga_user_1",
        amount: "10",
        network: "POLYGON",
        address: "0xabc"
      },
      "quote_usdc_idem_123"
    );

    expect(result).toMatchObject({
      fees: {
        provider: { amount: "0", currency: "USDC" },
        reepay: { amount: "0.203", currency: "USDC" }
      },
      totalFee: { amount: "0.203", currency: "USDC" },
      totalDebit: { amount: "10.203", currency: "USDC" },
      rate: "1"
    });
  });

  it("quotes EUR payout from XAF using provider FX quote and configured fees", async () => {
    const prisma = {
      payoutQuote: {
        findUnique: vi.fn(),
        create: vi.fn().mockResolvedValue({
          id: "quote_123",
          sourceCurrency: WalletCurrency.XAF,
          destinationCurrency: "EUR",
          destinationAmount: new Prisma.Decimal("250"),
          sourceAmount: new Prisma.Decimal("164000"),
          providerFee: new Prisma.Decimal("0"),
          reepayFee: new Prisma.Decimal("100"),
          totalDebit: new Prisma.Decimal("164100"),
          rate: new Prisma.Decimal("0.00152439"),
          quotedAt: now,
          expiresAt: new Date("2026-08-27T00:01:00.000Z"),
          recipientIban: "FR7630006000011234567890189",
          recipientName: "Jane Doe"
        })
      }
    } as unknown as PrismaService;
    const kryptaPay = {
      createIndicativeConversionQuote: vi.fn().mockResolvedValue({
        from: "XAF",
        to: "EUR",
        fromAmount: "164000",
        toAmount: "250",
        appliedRate: "0.00152439",
        expiresAt: "2026-08-27T00:01:00.000Z"
      })
    } as unknown as KryptaPayClient;
    const service = new PayoutsService(prisma, kryptaPay, new FeeService(config()), config(), sangapayWebhooks());

    const result = await service.createEurPayoutQuote(
      {
        customerId: "sanga_user_1",
        amount: "250",
        iban: "FR76 3000 6000 0112 3456 7890 189",
        beneficiaryName: "Jane Doe"
      },
      "req_123",
      "quote_idem_123"
    );

    expect(kryptaPay.createIndicativeConversionQuote).toHaveBeenCalledWith(
      { from: "XAF", to: "EUR", amount: "250", side: "credit_to" },
      expect.objectContaining({ requestId: "req_123" })
    );
    expect(result).toMatchObject({
      source: { amount: "164000", currency: "XAF" },
      destination: { amount: "250", currency: "EUR" },
      fees: {
        provider: { amount: "0", currency: "XAF" },
        reepay: { amount: "100", currency: "XAF" }
      },
      totalFee: { amount: "100", currency: "XAF" },
      totalDebit: { amount: "164100", currency: "XAF" }
    });
  });

  it("requires an idempotency key for payout confirmation", async () => {
    const service = new PayoutsService(
      {} as PrismaService,
      {} as KryptaPayClient,
      {} as FeeService,
      config(),
      sangapayWebhooks()
    );

    await expect(service.confirmEurPayout({ quoteId: "quote_123" })).rejects.toBeInstanceOf(BadRequestException);
  });

  it("atomically debits XAF wallet before creating KryptaPay payout and keeps status processing", async () => {
    const tx = buildReserveTransactionMocks();
    const prisma = {
      payout: {
        findUnique: vi.fn(),
        update: vi.fn().mockResolvedValue({
          id: "payout_123",
          status: PayoutStatus.PROCESSING,
          amount: new Prisma.Decimal("250"),
          currency: "EUR",
          totalDebit: new Prisma.Decimal("164100"),
          providerReference: "kp_payout_ref",
          providerTransactionId: "kp_payout_id",
          merchantReference: "rp_eur_quote_123",
          createdAt: now,
          updatedAt: now,
          completedAt: null
        })
      },
      $transaction: vi.fn((callback: (client: typeof tx) => Promise<unknown>) => callback(tx))
    } as unknown as PrismaService;
    const kryptaPay = {
      createPayout: vi.fn().mockResolvedValue({
        id: "kp_payout_id",
        reference: "kp_payout_ref",
        status: "processing",
        amount: "250",
        currency: "EUR",
        recipient: {},
        trace: {
          provider: "kryptapay",
          providerTransactionId: "kp_payout_id",
          providerReference: "kp_payout_ref",
          merchantReference: "rp_eur_quote_123"
        }
      })
    } as unknown as KryptaPayClient;
    const service = new PayoutsService(prisma, kryptaPay, new FeeService(config()), config(), sangapayWebhooks());

    const result = await service.confirmEurPayout({ quoteId: "quote_123" }, "req_123", "idem_payout_123");

    expect(tx.wallet.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { balance: { decrement: new Prisma.Decimal("164100") } }
      })
    );
    expect(tx.ledgerEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "DEBIT",
          amount: new Prisma.Decimal("164100")
        })
      })
    );
    expect(kryptaPay.createPayout).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: "250",
        currency: "EUR",
        network: "BANK_EUR",
        recipient: expect.objectContaining({
          iban: "FR7630006000011234567890189",
          fullName: "Jane Doe"
        })
      }),
      expect.objectContaining({
        requestId: "req_123",
        idempotencyKey: "idem_payout_123",
        merchantReference: "rp_eur_quote_123"
      })
    );
    expect(result.status).toBe("processing");
  });

  it("rejects confirmation when the quote is expired or balance is insufficient", async () => {
    const tx = buildReserveTransactionMocks({
      quoteExpiresAt: new Date("2020-01-01T00:00:00.000Z")
    });
    const prisma = {
      payout: { findUnique: vi.fn() },
      $transaction: vi.fn((callback: (client: typeof tx) => Promise<unknown>) => callback(tx))
    } as unknown as PrismaService;
    const service = new PayoutsService(prisma, {} as KryptaPayClient, new FeeService(config()), config(), sangapayWebhooks());

    await expect(service.confirmEurPayout({ quoteId: "quote_123" }, "req_123", "idem_payout_123")).rejects.toBeInstanceOf(
      ConflictException
    );
  });

  it("performs exactly one wallet reversal for failed provider payout", async () => {
    const tx = {
      payout: {
        findUnique: vi.fn().mockResolvedValue({
          id: "payout_123",
          customerId: "customer_123",
          walletId: "wallet_123",
          amount: new Prisma.Decimal("250"),
          currency: "EUR",
          totalDebit: new Prisma.Decimal("164100"),
          status: PayoutStatus.PROCESSING,
          provider: "kryptapay",
          providerReference: "kp_payout_ref",
          providerTransactionId: "kp_payout_id",
          merchantReference: "rp_eur_quote_123",
          customer: { id: "customer_123", externalId: "sanga_user_1" }
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 })
      },
      wallet: {
        update: vi.fn().mockResolvedValue({ id: "wallet_123", balance: new Prisma.Decimal("500000") })
      },
      transaction: {
        create: vi.fn().mockResolvedValue({ id: "txn_reversal_123" }),
        updateMany: vi.fn()
      },
      ledgerEntry: { create: vi.fn() },
      notificationEvent: { create: vi.fn() }
    };
    const prisma = {
      payout: {
        findFirst: vi.fn().mockResolvedValue({
          id: "payout_123",
          customerId: "customer_123",
          walletId: "wallet_123",
          amount: new Prisma.Decimal("250"),
          currency: "EUR",
          totalDebit: new Prisma.Decimal("164100")
        })
      },
      $transaction: vi.fn((callback: (client: typeof tx) => Promise<unknown>) => callback(tx))
    } as unknown as PrismaService;
    const kryptaPay = {
      getPayout: vi.fn().mockResolvedValue({
        id: "kp_payout_id",
        reference: "kp_payout_ref",
        status: "failed",
        amount: "250",
        currency: "EUR",
        recipient: {},
        failureReason: "rejected",
        trace: {
          provider: "kryptapay",
          providerTransactionId: "kp_payout_id",
          providerReference: "kp_payout_ref",
          merchantReference: "rp_status"
        }
      })
    } as unknown as KryptaPayClient;
    const service = new PayoutsService(prisma, kryptaPay, new FeeService(config()), config(), sangapayWebhooks());

    await service.markProviderPayoutSettled("kp_payout_ref", "failed", "rejected");

    expect(tx.payout.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "payout_123", reversedAt: null }
      })
    );
    expect(tx.wallet.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { balance: { increment: new Prisma.Decimal("164100") } }
      })
    );
    expect(tx.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: TransactionType.PAYOUT_REVERSAL,
          status: TransactionStatus.COMPLETED,
          amount: new Prisma.Decimal("164100")
        })
      })
    );
  });
});

function buildReserveTransactionMocks(overrides: { quoteExpiresAt?: Date; walletBalance?: Prisma.Decimal } = {}) {
  const quoteExpiresAt = overrides.quoteExpiresAt ?? new Date(Date.now() + 60_000);
  return {
    payoutQuote: {
      findUnique: vi.fn().mockResolvedValue({
        id: "quote_123",
        customerId: "customer_123",
        sourceCurrency: WalletCurrency.XAF,
        destinationCurrency: "EUR",
        destinationAmount: new Prisma.Decimal("250"),
        sourceAmount: new Prisma.Decimal("164000"),
        providerFee: new Prisma.Decimal("0"),
        reepayFee: new Prisma.Decimal("100"),
        totalDebit: new Prisma.Decimal("164100"),
        rate: new Prisma.Decimal("0.00152439"),
        expiresAt: quoteExpiresAt,
        recipientIban: "FR7630006000011234567890189",
        recipientName: "Jane Doe",
        recipientBankName: "Test Bank",
        merchantReference: "rp_eur_quote_123",
        confirmedAt: null,
        customer: { id: "customer_123", externalId: "sanga_user_1" }
      }),
      update: vi.fn()
    },
    wallet: {
      findUnique: vi.fn().mockResolvedValue({
        id: "wallet_123",
        balance: overrides.walletBalance ?? new Prisma.Decimal("500000"),
        currency: WalletCurrency.XAF
      }),
      update: vi.fn().mockResolvedValue({
        id: "wallet_123",
        balance: new Prisma.Decimal("335900")
      })
    },
    payout: {
      create: vi.fn().mockResolvedValue({
        id: "payout_123",
        merchantReference: "rp_eur_quote_123"
      })
    },
    transaction: {
      create: vi.fn().mockResolvedValue({ id: "txn_123" })
    },
    ledgerEntry: { create: vi.fn() },
    notificationEvent: { create: vi.fn() }
  };
}
