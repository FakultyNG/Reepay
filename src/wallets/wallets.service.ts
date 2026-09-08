import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { WalletCurrency } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { KryptaPayClient } from "../providers/kryptapay";
import { TransactionsService } from "../transactions/transactions.service";

@Injectable()
export class WalletsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(KryptaPayClient) private readonly kryptaPay: KryptaPayClient,
    @Inject(TransactionsService) private readonly transactions: TransactionsService
  ) {}

  async getBalance(customerExternalId: string, currency: WalletCurrency = WalletCurrency.XAF) {
    const wallet = await this.getAuthoritativeWallet(customerExternalId, currency);

    return {
      customerId: customerExternalId,
      currency,
      balance: wallet?.balance.toFixed() ?? "0",
      sourceOfTruth: "reepay_ledger"
    };
  }

  async getSummary(customerExternalId: string, requestId?: string) {
    const [xafBalance, eurBalance, usdcBalance] = await Promise.all([
      this.getBalance(customerExternalId, WalletCurrency.XAF),
      this.getBalance(customerExternalId, WalletCurrency.EUR),
      this.getBalance(customerExternalId, WalletCurrency.USDC)
    ]);
    const quotedAt = new Date().toISOString();
    const [usdcQuote, eurQuote] = await Promise.all([
      this.kryptaPay.createIndicativeConversionQuote(
        {
          from: "XAF",
          to: "USDC",
          amount: xafBalance.balance,
          side: "debit_from"
        },
        { requestId }
      ),
      this.kryptaPay.createIndicativeConversionQuote(
        {
          from: "XAF",
          to: "EUR",
          amount: xafBalance.balance,
          side: "debit_from"
        },
        { requestId }
      )
    ]);

    return {
      xaf: {
        balance: xafBalance.balance,
        currency: WalletCurrency.XAF,
        sourceOfTruth: "reepay_ledger"
      },
      wallets: {
        XAF: {
          balance: xafBalance.balance,
          currency: WalletCurrency.XAF,
          sourceOfTruth: "reepay_ledger"
        },
        EUR: {
          balance: eurBalance.balance,
          currency: WalletCurrency.EUR,
          provider: "wise",
          sourceOfTruth: "reepay_ledger"
        },
        USDC: {
          balance: usdcBalance.balance,
          currency: WalletCurrency.USDC,
          provider: "kryptapay",
          sourceOfTruth: "reepay_ledger"
        }
      },
      equivalents: {
        USDC: {
          amount: usdcQuote.toAmount,
          currency: "USDC",
          displayOnly: true,
          quotedAt,
          expiresAt: usdcQuote.expiresAt
        },
        EUR: {
          amount: eurQuote.toAmount,
          currency: "EUR",
          displayOnly: true,
          quotedAt,
          expiresAt: eurQuote.expiresAt
        }
      }
    };
  }

  getFundingInstructions(customerExternalId: string) {
    return {
      customerId: customerExternalId,
      currency: WalletCurrency.XAF,
      available: false,
      type: "dva",
      instructions: undefined,
      reason: "XAF DVA funding instructions are not configured for this market"
    };
  }

  getRecentTransactions(customerExternalId: string, limit = 10) {
    return this.transactions.listTransactions(customerExternalId, limit);
  }

  private async getAuthoritativeWallet(customerExternalId: string, currency: WalletCurrency) {
    const customer = await this.prisma.customer.findUnique({
      where: { externalId: customerExternalId },
      include: {
        wallets: {
          where: { currency }
        }
      }
    });

    if (!customer) {
      throw new NotFoundException("Customer wallet not found");
    }

    return customer.wallets[0];
  }
}
