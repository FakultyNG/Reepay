import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException
} from "@nestjs/common";
import { Prisma, TransactionStatus, TransactionType, WalletConversionStatus, WalletCurrency } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { FeeService } from "../common/fees/fee.service";
import { parseMoneyDecimal } from "../common/money/decimal";
import { AppConfigService } from "../config/app-config.service";
import { PrismaService } from "../database/prisma.service";
import { KryptaPayClient } from "../providers/kryptapay";
import { SangaPayWebhookDispatcher } from "../webhooks/sangapay";
import type { ConfirmWalletConversionDto } from "./dto/confirm-wallet-conversion.dto";
import type { CreateWalletConversionQuoteDto } from "./dto/create-wallet-conversion-quote.dto";

type DestinationWalletCurrency = "EUR" | "USDC";

@Injectable()
export class WalletConversionsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(KryptaPayClient) private readonly kryptaPay: KryptaPayClient,
    @Inject(FeeService) private readonly feeService: FeeService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
    @Inject(SangaPayWebhookDispatcher) private readonly sangapayWebhooks: SangaPayWebhookDispatcher
  ) {}

  async createQuote(
    dto: CreateWalletConversionQuoteDto,
    destinationCurrency: DestinationWalletCurrency,
    requestId?: string,
    idempotencyKey?: string
  ) {
    if (idempotencyKey) {
      const existing = await this.prisma.walletConversionQuote.findUnique({ where: { idempotencyKey } });
      if (existing) {
        return this.toQuoteResponse(existing);
      }
    }

    const destinationAmount = parseMoneyDecimal(dto.amount);
    const merchantReference = this.createMerchantReference(`wallet_${destinationCurrency.toLowerCase()}_quote`);
    const fxQuote = await this.kryptaPay.createIndicativeConversionQuote(
      {
        from: "XAF",
        to: destinationCurrency,
        amount: destinationAmount.toFixed(),
        side: "credit_to"
      },
      { requestId, merchantReference }
    );
    const sourceAmount = parseMoneyDecimal(fxQuote.fromAmount);
    const providerFee = new Prisma.Decimal(0);
    const reepayFee = this.feeService.calculateCustomerFeeDecimal(sourceAmount);
    const totalDebit = sourceAmount.add(providerFee).add(reepayFee).toDecimalPlaces(4);
    const expiresAt = new Date(fxQuote.expiresAt);

    if (Number.isNaN(expiresAt.getTime())) {
      throw new BadRequestException("Provider FX quote returned an invalid expiry");
    }

    const quote = await this.prisma.walletConversionQuote.create({
      data: {
        customer: {
          connectOrCreate: {
            where: { externalId: dto.customerId },
            create: { externalId: dto.customerId }
          }
        },
        sourceCurrency: WalletCurrency.XAF,
        destinationCurrency,
        sourceAmount,
        destinationAmount,
        providerFee,
        reepayFee,
        totalDebit,
        rate: new Prisma.Decimal(fxQuote.appliedRate),
        provider: destinationCurrency === WalletCurrency.EUR ? "wise" : "kryptapay",
        providerQuoteExpiresAt: expiresAt,
        expiresAt,
        merchantReference,
        ...(idempotencyKey ? { idempotencyKey } : {})
      }
    });

    return this.toQuoteResponse(quote);
  }

  async confirm(
    dto: ConfirmWalletConversionDto,
    expectedDestinationCurrency?: DestinationWalletCurrency,
    requestId?: string,
    idempotencyKey?: string
  ) {
    if (!idempotencyKey) {
      throw new BadRequestException("Idempotency-Key is required for wallet conversion confirmation");
    }

    const existing = await this.prisma.walletConversion.findUnique({ where: { idempotencyKey } });
    if (existing) {
      return this.toConversionResponse(existing);
    }

    const reserved = await this.reserveSourceWallet(dto.quoteId, idempotencyKey, expectedDestinationCurrency);

    try {
      if (reserved.destinationCurrency === WalletCurrency.USDC) {
        const providerConversion = await this.kryptaPay.executeConversion(
          {
            from: "XAF",
            to: "USDC",
            amount: reserved.sourceAmount
          },
          {
            requestId,
            idempotencyKey,
            merchantReference: reserved.merchantReference
          }
        );

        if (providerConversion.status.toLowerCase() === "completed") {
          return this.settleConversion(reserved.conversionId, withoutUndefined({
            providerReference: providerConversion.reference,
            providerTransactionId: providerConversion.trace.providerTransactionId,
            requestId
          }));
        }

        const updateData: Prisma.WalletConversionUpdateInput = {
          status: WalletConversionStatus.PROCESSING,
          providerReference: providerConversion.reference
        };
        if (providerConversion.trace.providerTransactionId) {
          updateData.providerTransactionId = providerConversion.trace.providerTransactionId;
        }

        await this.prisma.walletConversion.update({
          where: { id: reserved.conversionId },
          data: updateData
        });
        await this.dispatchProcessingConversion(reserved.conversionId, requestId);
        return this.getConversion(reserved.conversionId);
      }

      const fundingRecipient = this.wiseEurFundingRecipient();
      const providerPayout = await this.kryptaPay.createPayout(
        {
          amount: reserved.destinationAmount,
          currency: "EUR",
          network: "BANK_EUR",
          recipient: {
            iban: fundingRecipient.iban,
            fullName: fundingRecipient.accountName,
            bankName: fundingRecipient.bankName
          },
          description: "EUR wallet funding via SEPA Instant"
        },
        {
          requestId,
          idempotencyKey,
          merchantReference: reserved.merchantReference
        }
      );

      await this.prisma.walletConversion.update({
        where: { id: reserved.conversionId },
        data: {
          status: WalletConversionStatus.PROCESSING,
          providerReference: providerPayout.reference,
          ...(providerPayout.trace.providerTransactionId
            ? { providerTransactionId: providerPayout.trace.providerTransactionId }
            : {})
        }
      });

      await this.dispatchProcessingConversion(reserved.conversionId, requestId);
      return this.getConversion(reserved.conversionId);
    } catch (error) {
      await this.reverseConversion(reserved.conversionId, "Provider wallet conversion failed");
      throw error;
    }
  }

  async markProviderConversionSettled(providerReference: string, requestId?: string) {
    const handled = await this.tryMarkProviderConversionSettled(providerReference, requestId);
    if (!handled) {
      throw new NotFoundException("Wallet conversion not found for provider reference");
    }
  }

  async tryMarkProviderConversionSettled(providerReference: string, requestId?: string) {
    const conversion = await this.prisma.walletConversion.findFirst({
      where: {
        OR: [{ providerReference }, { merchantReference: providerReference }]
      }
    });

    if (!conversion) {
      return false;
    }

    await this.settleConversion(conversion.id, withoutUndefined({ providerReference, requestId }));
    return true;
  }

  async tryMarkProviderConversionFailed(providerReference: string, reason: string) {
    const conversion = await this.prisma.walletConversion.findFirst({
      where: {
        OR: [{ providerReference }, { merchantReference: providerReference }]
      }
    });

    if (!conversion) {
      return false;
    }

    await this.reverseConversion(conversion.id, reason);
    return true;
  }

  async getConversion(id: string) {
    const conversion = await this.prisma.walletConversion.findUnique({ where: { id } });
    if (!conversion) {
      throw new NotFoundException("Wallet conversion not found");
    }

    return this.toConversionResponse(conversion);
  }

  async reconcileProviderConversionStatus(id: string, requestId?: string) {
    const conversion = await this.prisma.walletConversion.findUnique({ where: { id } });

    if (!conversion) {
      throw new NotFoundException("Wallet conversion not found");
    }

    if (
      conversion.status === WalletConversionStatus.COMPLETED ||
      conversion.status === WalletConversionStatus.FAILED ||
      conversion.status === WalletConversionStatus.REFUNDED
    ) {
      return { reconciled: false, terminal: true, status: conversion.status.toLowerCase() };
    }

    const providerReference = conversion.providerReference ?? conversion.providerTransactionId;
    if (!providerReference) {
      return { reconciled: false, status: conversion.status.toLowerCase(), reason: "missing_provider_reference" };
    }

    if (conversion.destinationCurrency === WalletCurrency.EUR) {
      const providerPayout = await this.kryptaPay.getPayout(providerReference, {
        requestId,
        merchantReference: conversion.merchantReference
      });

      if (providerPayout.status === "completed") {
        await this.markProviderConversionSettled(providerReference, requestId);
        return { reconciled: true, status: WalletConversionStatus.COMPLETED.toLowerCase() };
      }

      if (providerPayout.status === "failed" || providerPayout.status === "cancelled" || providerPayout.status === "refunded") {
        await this.tryMarkProviderConversionFailed(
          providerReference,
          providerPayout.failureReason ?? `Provider wallet funding payout ${providerPayout.status}`
        );
        return { reconciled: true, status: WalletConversionStatus.FAILED.toLowerCase() };
      }

      return { reconciled: false, status: providerPayout.status };
    }

    return {
      reconciled: false,
      status: conversion.status.toLowerCase(),
      reason: "provider_conversion_status_endpoint_unavailable"
    };
  }

  private async reserveSourceWallet(
    quoteId: string,
    idempotencyKey: string,
    expectedDestinationCurrency?: DestinationWalletCurrency
  ) {
    return this.prisma.$transaction(async (tx) => {
      const quote = await tx.walletConversionQuote.findUnique({
        where: { id: quoteId },
        include: { customer: true }
      });

      if (!quote) {
        throw new NotFoundException("Wallet conversion quote not found");
      }

      if (
        expectedDestinationCurrency &&
        quote.destinationCurrency !== expectedDestinationCurrency
      ) {
        throw new BadRequestException("Wallet conversion quote currency does not match endpoint");
      }

      if (quote.expiresAt.getTime() <= Date.now()) {
        throw new ConflictException("Wallet conversion quote has expired");
      }

      if (quote.confirmedAt) {
        throw new ConflictException("Wallet conversion quote has already been confirmed");
      }

      const wallet = await tx.wallet.findUnique({
        where: {
          customerId_currency: {
            customerId: quote.customerId,
            currency: WalletCurrency.XAF
          }
        }
      });

      if (!wallet || wallet.balance.lessThan(quote.totalDebit)) {
        throw new ConflictException("Insufficient XAF wallet balance");
      }

      const updatedWallet = await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          balance: {
            decrement: quote.totalDebit
          }
        }
      });

      const conversion = await tx.walletConversion.create({
        data: {
          customerId: quote.customerId,
          sourceWalletId: wallet.id,
          quoteId: quote.id,
          sourceCurrency: WalletCurrency.XAF,
          destinationCurrency: quote.destinationCurrency,
          sourceAmount: quote.sourceAmount,
          destinationAmount: quote.destinationAmount,
          providerFee: quote.providerFee,
          reepayFee: quote.reepayFee,
          totalDebit: quote.totalDebit,
          status: WalletConversionStatus.PROCESSING,
          provider: quote.provider,
          merchantReference: quote.merchantReference,
          idempotencyKey
        }
      });

      const transaction = await tx.transaction.create({
        data: {
          customerId: quote.customerId,
          conversionId: conversion.id,
          type: TransactionType.WALLET_CONVERSION,
          status: TransactionStatus.PROCESSING,
          amount: quote.totalDebit,
          currency: WalletCurrency.XAF,
          provider: quote.provider,
          merchantReference: quote.merchantReference
        }
      });

      await tx.ledgerEntry.create({
        data: {
          walletId: wallet.id,
          customerId: quote.customerId,
          conversionId: conversion.id,
          transactionId: transaction.id,
          type: "DEBIT",
          amount: quote.totalDebit,
          currency: WalletCurrency.XAF,
          balanceAfter: updatedWallet.balance,
          description: `${quote.destinationCurrency} wallet funding debit`
        }
      });

      await tx.walletConversionQuote.update({
        where: { id: quote.id },
        data: { confirmedAt: new Date() }
      });

      await tx.notificationEvent.create({
        data: {
          customerId: quote.customerId,
          type: "WALLET_CONVERSION_PROCESSING",
          payload: {
            conversionId: conversion.id,
            sourceAmount: quote.totalDebit.toFixed(),
            sourceCurrency: WalletCurrency.XAF,
            destinationAmount: quote.destinationAmount.toFixed(),
            destinationCurrency: quote.destinationCurrency
          }
        }
      });

      return {
        conversionId: conversion.id,
        customerExternalId: quote.customer.externalId,
        sourceAmount: quote.sourceAmount.toFixed(),
        destinationAmount: quote.destinationAmount.toFixed(),
        destinationCurrency: quote.destinationCurrency,
        merchantReference: quote.merchantReference
      };
    });
  }

  private async settleConversion(
    conversionId: string,
    provider: { providerReference?: string | undefined; providerTransactionId?: string | undefined; requestId?: string | undefined }
  ) {
    const result = await this.prisma.$transaction(async (tx) => {
      const conversion = await tx.walletConversion.findUnique({
        where: { id: conversionId },
        include: { customer: true }
      });

      if (!conversion) {
        throw new NotFoundException("Wallet conversion not found");
      }

      if (conversion.status === WalletConversionStatus.COMPLETED) {
        return {
          response: this.toConversionResponse(conversion),
          eventPayload: undefined
        };
      }

      const destinationWallet = await tx.wallet.upsert({
        where: {
          customerId_currency: {
            customerId: conversion.customerId,
            currency: conversion.destinationCurrency
          }
        },
        update: {
          balance: {
            increment: conversion.destinationAmount
          }
        },
        create: {
          customerId: conversion.customerId,
          currency: conversion.destinationCurrency,
          balance: conversion.destinationAmount
        }
      });

      const updated = await tx.walletConversion.update({
        where: { id: conversion.id },
        data: {
          destinationWalletId: destinationWallet.id,
          status: WalletConversionStatus.COMPLETED,
          completedAt: new Date(),
          ...(provider.providerReference ? { providerReference: provider.providerReference } : {}),
          ...(provider.providerTransactionId ? { providerTransactionId: provider.providerTransactionId } : {})
        }
      });

      await tx.transaction.updateMany({
        where: { conversionId: conversion.id, type: TransactionType.WALLET_CONVERSION },
        data: {
          status: TransactionStatus.COMPLETED,
          ...(provider.providerReference ? { providerReference: provider.providerReference } : {}),
          ...(provider.providerTransactionId ? { providerTransactionId: provider.providerTransactionId } : {})
        }
      });

      const transaction = await tx.transaction.findFirst({
        where: { conversionId: conversion.id, type: TransactionType.WALLET_CONVERSION }
      });

      await tx.ledgerEntry.create({
        data: {
          walletId: destinationWallet.id,
          customerId: conversion.customerId,
          conversionId: conversion.id,
          ...(transaction?.id ? { transactionId: transaction.id } : {}),
          type: "CREDIT",
          amount: conversion.destinationAmount,
          currency: conversion.destinationCurrency,
          balanceAfter: destinationWallet.balance,
          description: `${conversion.destinationCurrency} wallet funding credit`
        }
      });

      await tx.notificationEvent.create({
        data: {
          customerId: conversion.customerId,
          type: "WALLET_CONVERSION_COMPLETED",
          payload: {
            conversionId: conversion.id,
            sourceAmount: conversion.totalDebit.toFixed(),
            sourceCurrency: WalletCurrency.XAF,
            destinationAmount: conversion.destinationAmount.toFixed(),
            destinationCurrency: conversion.destinationCurrency
          }
        }
      });

      const eventPayload = {
          customerId: conversion.customer.externalId,
          conversionId: conversion.id,
          source: {
            amount: conversion.totalDebit.toFixed(),
            currency: WalletCurrency.XAF
          },
          destination: {
            amount: conversion.destinationAmount.toFixed(),
            currency: conversion.destinationCurrency
          },
          status: WalletConversionStatus.COMPLETED.toLowerCase(),
          reference: conversion.merchantReference
        };

      return {
        response: this.toConversionResponse(updated),
        eventPayload
      };
    });

    if (result.eventPayload) {
      await this.sangapayWebhooks.dispatch("wallet.conversion.completed", result.eventPayload, provider.requestId);
    }

    return result.response;
  }

  private async reverseConversion(conversionId: string, reason: string) {
    const eventPayload = await this.prisma.$transaction(async (tx) => {
      const conversion = await tx.walletConversion.findUnique({ where: { id: conversionId }, include: { customer: true } });
      if (!conversion || conversion.reversedAt) {
        return;
      }

      const wallet = await tx.wallet.update({
        where: { id: conversion.sourceWalletId },
        data: {
          balance: {
            increment: conversion.totalDebit
          }
        }
      });

      await tx.walletConversion.update({
        where: { id: conversion.id },
        data: {
          status: WalletConversionStatus.FAILED,
          failureReason: reason,
          reversedAt: new Date()
        }
      });

      await tx.transaction.create({
        data: {
          customerId: conversion.customerId,
          conversionId: conversion.id,
          type: TransactionType.WALLET_CONVERSION_REVERSAL,
          status: TransactionStatus.COMPLETED,
          amount: conversion.totalDebit,
          currency: WalletCurrency.XAF,
          provider: conversion.provider,
          merchantReference: `${conversion.merchantReference}_reversal`
        }
      });

      await tx.ledgerEntry.create({
        data: {
          walletId: conversion.sourceWalletId,
          customerId: conversion.customerId,
          conversionId: conversion.id,
          type: "CREDIT",
          amount: conversion.totalDebit,
          currency: WalletCurrency.XAF,
          balanceAfter: wallet.balance,
          description: `${conversion.destinationCurrency} wallet funding reversal`
        }
      });

      await tx.notificationEvent.create({
        data: {
          customerId: conversion.customerId,
          type: "WALLET_CONVERSION_FAILED",
          payload: {
            conversionId: conversion.id,
            reason,
            reversedAmount: conversion.totalDebit.toFixed(),
            reversedCurrency: WalletCurrency.XAF,
            destinationCurrency: conversion.destinationCurrency
          }
        }
      });

      return {
        customerId: conversion.customer.externalId,
        conversionId: conversion.id,
        source: {
          amount: conversion.totalDebit.toFixed(),
          currency: WalletCurrency.XAF
        },
        destination: {
          amount: conversion.destinationAmount.toFixed(),
          currency: conversion.destinationCurrency
        },
        status: WalletConversionStatus.FAILED.toLowerCase(),
        reference: conversion.merchantReference,
        reason
      };
    });

    if (eventPayload) {
      await this.sangapayWebhooks.dispatch("wallet.conversion.failed", eventPayload);
    }
  }

  private async dispatchProcessingConversion(conversionId: string, requestId?: string) {
    const conversion = await this.prisma.walletConversion.findUnique({
      where: { id: conversionId },
      include: { customer: true }
    });

    if (!conversion) {
      return;
    }

    await this.sangapayWebhooks.dispatch(
      "wallet.conversion.processing",
      {
        customerId: conversion.customer.externalId,
        conversionId: conversion.id,
        source: {
          amount: conversion.totalDebit.toFixed(),
          currency: WalletCurrency.XAF
        },
        destination: {
          amount: conversion.destinationAmount.toFixed(),
          currency: conversion.destinationCurrency
        },
        status: conversion.status.toLowerCase(),
        reference: conversion.merchantReference
      },
      requestId
    );
  }

  private wiseEurFundingRecipient() {
    const { eurFundingIban, eurFundingAccountName, eurFundingBankName } = this.config.wise;
    if (!eurFundingIban || !eurFundingAccountName || !eurFundingBankName) {
      throw new ServiceUnavailableException("Wise EUR funding account is not configured");
    }

    return {
      iban: eurFundingIban.replace(/\s/g, "").toUpperCase(),
      accountName: eurFundingAccountName,
      bankName: eurFundingBankName
    };
  }

  private createMerchantReference(prefix: string) {
    return `rp_${prefix}_${Date.now().toString(36)}_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  }

  private toQuoteResponse(quote: {
    id: string;
    sourceCurrency: WalletCurrency;
    destinationCurrency: WalletCurrency;
    sourceAmount: Prisma.Decimal;
    destinationAmount: Prisma.Decimal;
    providerFee: Prisma.Decimal;
    reepayFee: Prisma.Decimal;
    totalDebit: Prisma.Decimal;
    rate: Prisma.Decimal;
    provider: string;
    quotedAt: Date;
    expiresAt: Date;
  }) {
    return {
      id: quote.id,
      source: {
        amount: quote.sourceAmount.toFixed(),
        currency: quote.sourceCurrency
      },
      destination: {
        amount: quote.destinationAmount.toFixed(),
        currency: quote.destinationCurrency
      },
      fees: {
        provider: { amount: quote.providerFee.toFixed(), currency: WalletCurrency.XAF },
        reepay: { amount: quote.reepayFee.toFixed(), currency: WalletCurrency.XAF }
      },
      totalDebit: {
        amount: quote.totalDebit.toFixed(),
        currency: WalletCurrency.XAF
      },
      provider: quote.provider,
      rate: quote.rate.toFixed(),
      quotedAt: quote.quotedAt.toISOString(),
      expiresAt: quote.expiresAt.toISOString()
    };
  }

  private toConversionResponse(conversion: {
    id: string;
    status: WalletConversionStatus;
    sourceCurrency: WalletCurrency;
    destinationCurrency: WalletCurrency;
    totalDebit: Prisma.Decimal;
    destinationAmount: Prisma.Decimal;
    merchantReference: string;
    createdAt: Date;
    updatedAt: Date;
    completedAt: Date | null;
  }) {
    return {
      id: conversion.id,
      status: conversion.status.toLowerCase(),
      source: {
        amount: conversion.totalDebit.toFixed(),
        currency: conversion.sourceCurrency
      },
      destination: {
        amount: conversion.destinationAmount.toFixed(),
        currency: conversion.destinationCurrency
      },
      reference: conversion.merchantReference,
      createdAt: conversion.createdAt.toISOString(),
      updatedAt: conversion.updatedAt.toISOString(),
      completedAt: conversion.completedAt?.toISOString()
    };
  }
}

function withoutUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}
