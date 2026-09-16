import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  DepositStatus,
  LedgerEntryType,
  NotificationEventType,
  Prisma,
  TransactionStatus,
  TransactionType,
  WalletCurrency
} from "@prisma/client";
import { randomUUID } from "node:crypto";
import { FeeService } from "../common/fees/fee.service";
import { parseMoneyDecimal } from "../common/money/decimal";
import { PrismaService } from "../database/prisma.service";
import { KryptaPayClient } from "../providers/kryptapay";
import { SangaPayWebhookDispatcher } from "../webhooks/sangapay";
import type { CreateXafDepositQuoteDto } from "./dto/create-xaf-deposit-quote.dto";
import type { CreateXafDepositDto } from "./dto/create-xaf-deposit.dto";

@Injectable()
export class DepositsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(KryptaPayClient) private readonly kryptaPay: KryptaPayClient,
    @Inject(FeeService) private readonly feeService: FeeService,
    @Inject(SangaPayWebhookDispatcher) private readonly sangapayWebhooks: SangaPayWebhookDispatcher
  ) {}

  createXafDepositQuote(dto: CreateXafDepositQuoteDto) {
    const pricing = this.calculateXafDepositPricing(dto.amount);

    return {
      amount: pricing.creditedAmount.toFixed(),
      currency: WalletCurrency.XAF,
      creditedAmount: {
        amount: pricing.creditedAmount.toFixed(),
        currency: WalletCurrency.XAF
      },
      fees: {
        provider: { amount: pricing.providerFee.toFixed(), currency: WalletCurrency.XAF },
        reepay: { amount: pricing.reepayFee.toFixed(), currency: WalletCurrency.XAF }
      },
      totalFee: {
        amount: pricing.providerFee.add(pricing.reepayFee).toFixed(),
        currency: WalletCurrency.XAF
      },
      totalDebit: {
        amount: pricing.totalDebit.toFixed(),
        currency: WalletCurrency.XAF
      },
      network: dto.network,
      phoneNumber: dto.phoneNumber
    };
  }

  async createXafDeposit(dto: CreateXafDepositDto, requestId?: string, idempotencyKey?: string) {
    const { amount, creditedAmount, providerFee, reepayFee, totalDebit } = this.calculateXafDepositPricing(dto.amount);
    const merchantReference = `rp_dep_${Date.now().toString(36)}_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
    const effectiveIdempotencyKey = idempotencyKey ?? randomUUID();

    const existing = idempotencyKey
      ? await this.prisma.deposit.findUnique({ where: { idempotencyKey } })
      : null;

    if (existing) {
      return this.toDepositResponse(existing);
    }

    const payin = await this.kryptaPay.createPayinCheckout(
      {
        amount: totalDebit.toFixed(),
        currency: "XAF",
        network: dto.network,
        customer: {
          fullName: dto.fullName,
          msisdn: dto.phoneNumber,
          email: dto.email
        },
        redirectUrl: dto.redirectUrl,
        expiresInSec: dto.expiresInSec
      },
      {
        requestId,
        idempotencyKey: effectiveIdempotencyKey,
        merchantReference
      }
    );

    try {
      const expiresInSec = payin.expiresInSec ?? dto.expiresInSec;
      const expiresAt = parseOptionalDate(payin.expiresAt) ?? resolveExpiresAt(expiresInSec);
      const deposit = await this.prisma.deposit.create({
        data: {
          customer: {
            connectOrCreate: {
              where: { externalId: dto.customerId },
              create: { externalId: dto.customerId }
            }
          },
          amount,
          creditedAmount,
          providerFee,
          reepayFee,
          totalDebit,
          currency: WalletCurrency.XAF,
          network: dto.network,
          phoneNumber: dto.phoneNumber,
          status: "PENDING",
          merchantReference,
          provider: "kryptapay",
          providerReference: payin.reference,
          idempotencyKey: effectiveIdempotencyKey,
          ...(payin.checkoutUrl ? { checkoutUrl: payin.checkoutUrl } : {}),
          ...(payin.checkoutToken ? { checkoutToken: payin.checkoutToken } : {}),
          ...(expiresInSec ? { expiresInSec } : {}),
          ...(expiresAt ? { expiresAt } : {}),
          ...(payin.trace.providerTransactionId ? { providerTransactionId: payin.trace.providerTransactionId } : {}),
          ...(payin.trace.providerRequestId ? { providerRequestId: payin.trace.providerRequestId } : {})
        }
      });

      return this.toDepositResponse(deposit);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException("Deposit already exists for provider or merchant reference");
      }

      throw error;
    }
  }

  async getDepositStatus(id: string, requestId?: string) {
    const deposit = await this.prisma.deposit.findUnique({ where: { id } });

    if (!deposit) {
      throw new NotFoundException("Deposit not found");
    }

    if (deposit.status === DepositStatus.PENDING || deposit.status === DepositStatus.PROCESSING) {
      await this.reconcileProviderDepositStatus(id, requestId);
      const current = await this.prisma.deposit.findUnique({ where: { id } });

      if (!current) {
        throw new NotFoundException("Deposit not found");
      }

      return this.toDepositResponse(current);
    }

    return this.toDepositResponse(deposit);
  }

  async verifyDeposit(id: string, requestId?: string) {
    const deposit = await this.prisma.deposit.findUnique({ where: { id } });

    if (!deposit) {
      throw new NotFoundException("Deposit not found");
    }

    const providerStatus = await this.kryptaPay.getPayinStatus(deposit.providerReference, {
      requestId,
      merchantReference: deposit.merchantReference
    });
    const providerStatusChanged =
      providerStatus.status === "completed" ||
      providerStatus.status === "failed" ||
      providerStatus.status === "cancelled" ||
      providerStatus.status === "refunded";
    if (providerStatusChanged) {
      await this.reconcileProviderDepositStatus(id, requestId);
    }

    const current = await this.prisma.deposit.findUnique({ where: { id } });
    if (!current) {
      throw new NotFoundException("Deposit not found");
    }

    return {
      ...this.toDepositResponse(current),
      verification: {
        verified: true,
        status: providerStatus.status,
        amount: providerStatus.amount,
        currency: providerStatus.currency,
        expectedAmount: deposit.totalDebit.toFixed(),
        expectedCurrency: deposit.currency
      }
    };
  }

  async reconcileProviderDepositStatus(id: string, requestId?: string) {
    const deposit = await this.prisma.deposit.findUnique({ where: { id } });

    if (!deposit) {
      throw new NotFoundException("Deposit not found");
    }

    if (
      deposit.status === DepositStatus.COMPLETED ||
      deposit.status === DepositStatus.FAILED ||
      deposit.status === DepositStatus.CANCELLED ||
      deposit.status === DepositStatus.REFUNDED
    ) {
      return { reconciled: false, terminal: true, status: deposit.status.toLowerCase() };
    }

    const providerStatus = await this.kryptaPay.getPayinStatus(deposit.providerReference, {
      requestId,
      merchantReference: deposit.merchantReference
    });

    if (providerStatus.status === "completed") {
      const providerAmount = parseMoneyDecimal(providerStatus.amount);
      if (!deposit.totalDebit.equals(providerAmount) || deposit.currency !== WalletCurrency.XAF || providerStatus.currency !== "XAF") {
        throw new BadRequestException("Provider deposit status does not match internal deposit");
      }

      const eventPayload = await this.prisma.$transaction(async (tx) => {
        const current = await tx.deposit.findUnique({
          where: { id: deposit.id },
          include: { customer: true }
        });

        if (!current || current.status === DepositStatus.COMPLETED) {
          return undefined;
        }

        const wallet = await tx.wallet.upsert({
          where: {
            customerId_currency: {
              customerId: current.customerId,
              currency: WalletCurrency.XAF
            }
          },
          create: {
            customerId: current.customerId,
            currency: WalletCurrency.XAF,
            balance: current.amount
          },
          update: {
            balance: {
              increment: current.amount
            }
          }
        });

        const transaction = await tx.transaction.create({
          data: {
            customerId: current.customerId,
            depositId: current.id,
            type: TransactionType.WALLET_FUNDING,
            status: TransactionStatus.COMPLETED,
            amount: current.amount,
            currency: WalletCurrency.XAF,
            provider: "kryptapay",
            providerReference: current.providerReference,
            merchantReference: current.merchantReference,
            ...(providerStatus.trace.providerTransactionId
              ? { providerTransactionId: providerStatus.trace.providerTransactionId }
              : {})
          }
        });

        await tx.ledgerEntry.create({
          data: {
            walletId: wallet.id,
            customerId: current.customerId,
            depositId: current.id,
            transactionId: transaction.id,
            type: LedgerEntryType.CREDIT,
            amount: current.amount,
            currency: WalletCurrency.XAF,
            balanceAfter: wallet.balance,
            description: "XAF wallet funding reconciliation"
          }
        });

        if (current.reepayFee.greaterThan(0)) {
          await tx.reepayFeeEarning.createMany({
            data: [
              {
                sourceType: "DEPOSIT",
                sourceId: current.id,
                amount: current.reepayFee,
                currency: WalletCurrency.XAF,
                depositId: current.id
              }
            ],
            skipDuplicates: true
          });
        }

        await tx.deposit.update({
          where: { id: current.id },
          data: {
            walletId: wallet.id,
            status: DepositStatus.COMPLETED,
            completedAt: new Date(),
            ...(providerStatus.trace.providerTransactionId
              ? { providerTransactionId: providerStatus.trace.providerTransactionId }
              : {})
          }
        });

        await tx.notificationEvent.create({
          data: {
            customerId: current.customerId,
            type: NotificationEventType.DEPOSIT_COMPLETED,
            payload: {
              depositId: current.id,
              transactionId: transaction.id,
              amount: current.amount.toFixed(),
              currency: WalletCurrency.XAF,
              source: "reconciliation"
            }
          }
        });

        return {
          customerId: current.customer.externalId,
          depositId: current.id,
          transactionId: transaction.id,
          amount: current.amount.toFixed(),
          currency: WalletCurrency.XAF,
          status: DepositStatus.COMPLETED.toLowerCase(),
          reference: current.merchantReference
        };
      });

      if (eventPayload) {
        await this.sangapayWebhooks.dispatch("deposit.completed", eventPayload, requestId);
      }

      return { reconciled: true, status: DepositStatus.COMPLETED.toLowerCase() };
    }

    if (["failed", "cancelled", "refunded"].includes(providerStatus.status)) {
      const status = mapFailedDepositStatus(providerStatus.status);
      await this.prisma.deposit.updateMany({
        where: {
          id: deposit.id,
          status: {
            notIn: [DepositStatus.COMPLETED, DepositStatus.FAILED, DepositStatus.CANCELLED, DepositStatus.REFUNDED]
          }
        },
        data: {
          status,
          failureReason: `Provider deposit ${providerStatus.status}`
        }
      });
      return { reconciled: true, status: status.toLowerCase() };
    }

    return { reconciled: false, status: providerStatus.status };
  }

  toDepositResponse(deposit: {
    id: string;
    amount: Prisma.Decimal;
    creditedAmount?: Prisma.Decimal;
    providerFee?: Prisma.Decimal;
    reepayFee?: Prisma.Decimal;
    totalDebit?: Prisma.Decimal;
    currency: WalletCurrency;
    status: string;
    network: string;
    phoneNumber: string;
    merchantReference: string;
    providerReference: string;
    providerTransactionId: string | null;
    checkoutUrl: string | null;
    checkoutToken: string | null;
    expiresInSec?: number | null;
    expiresAt?: Date | null;
    failureReason: string | null;
    createdAt: Date;
    updatedAt: Date;
    completedAt: Date | null;
  }) {
    const creditedAmount = deposit.creditedAmount ?? deposit.amount;
    const providerFee = deposit.providerFee ?? new Prisma.Decimal(0);
    const reepayFee = deposit.reepayFee ?? new Prisma.Decimal(0);
    const totalDebit = deposit.totalDebit ?? deposit.amount;

    return {
      id: deposit.id,
      amount: creditedAmount.toFixed(),
      currency: deposit.currency,
      creditedAmount: {
        amount: creditedAmount.toFixed(),
        currency: deposit.currency
      },
      fees: {
        provider: { amount: providerFee.toFixed(), currency: deposit.currency },
        reepay: { amount: reepayFee.toFixed(), currency: deposit.currency }
      },
      providerFee: {
        amount: providerFee.toFixed(),
        currency: deposit.currency
      },
      reepayFee: {
        amount: reepayFee.toFixed(),
        currency: deposit.currency
      },
      totalFee: {
        amount: providerFee.add(reepayFee).toFixed(),
        currency: deposit.currency
      },
      totalDebit: {
        amount: totalDebit.toFixed(),
        currency: deposit.currency
      },
      status: deposit.status.toLowerCase(),
      network: deposit.network,
      phoneNumber: deposit.phoneNumber,
      reference: deposit.merchantReference,
      checkoutUrl: deposit.checkoutUrl ?? undefined,
      checkoutToken: deposit.checkoutToken ?? undefined,
      expiresInSec: deposit.expiresInSec ?? undefined,
      expiresAt: deposit.expiresAt?.toISOString(),
      failureReason: deposit.failureReason ?? undefined,
      createdAt: deposit.createdAt.toISOString(),
      updatedAt: deposit.updatedAt.toISOString(),
      completedAt: deposit.completedAt?.toISOString()
    };
  }

  private calculateXafDepositPricing(amountValue: string) {
    const amount = parseMoneyDecimal(amountValue);
    const creditedAmount = amount;
    const providerFee = new Prisma.Decimal(0);
    const reepayFee = this.feeService.calculateCustomerFeeDecimal(amount);
    const totalDebit = creditedAmount.add(providerFee).add(reepayFee).toDecimalPlaces(4);

    return { amount, creditedAmount, providerFee, reepayFee, totalDebit };
  }
}

function isUniqueConstraintError(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function mapFailedDepositStatus(status: string) {
  switch (status) {
    case "cancelled":
      return DepositStatus.CANCELLED;
    case "refunded":
      return DepositStatus.REFUNDED;
    default:
      return DepositStatus.FAILED;
  }
}

function parseOptionalDate(value?: string) {
  if (!value) {
    return undefined;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function resolveExpiresAt(expiresInSec?: number) {
  return expiresInSec ? new Date(Date.now() + expiresInSec * 1000) : undefined;
}
