import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { PayoutStatus, Prisma, TransactionStatus, TransactionType, WalletCurrency } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { FeeService } from "../common/fees/fee.service";
import { parseMoneyDecimal } from "../common/money/decimal";
import { AppConfigService } from "../config/app-config.service";
import { PrismaService } from "../database/prisma.service";
import { KryptaPayClient } from "../providers/kryptapay";
import { WiseClient } from "../providers/wise";
import { SangaPayWebhookDispatcher } from "../webhooks/sangapay";
import type { ConfirmEurPayoutDto } from "./dto/confirm-eur-payout.dto";
import type { CreateEurPayoutQuoteDto } from "./dto/create-eur-payout-quote.dto";
import type { CreateEurWiseTagPayoutQuoteDto } from "./dto/create-eur-wisetag-payout-quote.dto";
import type { CreateUsdcAddressPayoutQuoteDto } from "./dto/create-usdc-address-payout-quote.dto";

const sepaIbanPattern = /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/;

type ReservedWalletPayout = {
  payoutId: string;
  customerExternalId: string;
  merchantReference: string;
  provider: string;
  destinationType: string;
  amount: string;
  currency: string;
  sourceCurrency: WalletCurrency;
  recipientIban: string | null;
  recipientName: string | null;
  recipientBankName: string | null;
  recipientAddress: string | null;
  recipientWiseTag: string | null;
  providerFee: string;
};

type PayoutWalletCurrency = "EUR" | "USDC";

type SubmittedProviderPayout = {
  id: string;
  reference: string;
  providerCost?: Prisma.Decimal;
};

@Injectable()
export class PayoutsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(KryptaPayClient) private readonly kryptaPay: KryptaPayClient,
    @Inject(FeeService) private readonly feeService: FeeService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
    @Inject(SangaPayWebhookDispatcher) private readonly sangapayWebhooks: SangaPayWebhookDispatcher,
    @Inject(WiseClient) private readonly wise: WiseClient
  ) {}

  async createEurPayoutQuote(dto: CreateEurPayoutQuoteDto, requestId?: string, idempotencyKey?: string) {
    this.validateEurSepaRecipient(dto.iban);
    const destinationAmount = parseMoneyDecimal(dto.amount);
    const merchantReference = this.createMerchantReference("eur_quote");

    if (idempotencyKey) {
      const existing = await this.prisma.payoutQuote.findUnique({ where: { idempotencyKey } });
      if (existing) {
        return this.toQuoteResponse(existing);
      }
    }

    const fxQuote = await this.kryptaPay.createIndicativeConversionQuote(
      {
        from: "XAF",
        to: "EUR",
        amount: destinationAmount.toFixed(),
        side: "credit_to"
      },
      { requestId, merchantReference }
    );
    const sourceAmount = parseMoneyDecimal(fxQuote.fromAmount);
    const providerFee = new Prisma.Decimal(0);
    const reepayFee = this.feeService.calculateCustomerFeeDecimal(sourceAmount);
    const totalDebit = sourceAmount.add(providerFee).add(reepayFee).toDecimalPlaces(4);
    const providerQuoteExpiresAt = new Date(fxQuote.expiresAt);

    if (Number.isNaN(providerQuoteExpiresAt.getTime())) {
      throw new BadRequestException("Provider FX quote returned an invalid expiry");
    }

    const quote = await this.prisma.payoutQuote.create({
      data: {
        customer: {
          connectOrCreate: {
            where: { externalId: dto.customerId },
            create: { externalId: dto.customerId }
          }
        },
        sourceCurrency: WalletCurrency.XAF,
        destinationCurrency: "EUR",
        destinationAmount,
        sourceAmount,
        providerFee,
        reepayFee,
        totalDebit,
        rate: new Prisma.Decimal(fxQuote.appliedRate),
        providerQuoteExpiresAt,
        expiresAt: providerQuoteExpiresAt,
        recipientIban: normalizeIban(dto.iban),
        recipientName: dto.beneficiaryName,
        merchantReference,
        ...(dto.bankName ? { recipientBankName: dto.bankName } : {}),
        ...(dto.beneficiaryAddress ? { recipientAddress: dto.beneficiaryAddress } : {}),
        ...(idempotencyKey ? { idempotencyKey } : {})
      }
    });

    return this.toQuoteResponse(quote);
  }

  validateRecipient(iban: string, beneficiaryName: string) {
    this.validateEurSepaRecipient(iban);

    return {
      valid: true,
      corridor: "EUR_SEPA",
      recipient: {
        iban: normalizeIban(iban),
        name: beneficiaryName
      }
    };
  }

  async createEurIbanPayoutQuote(dto: CreateEurPayoutQuoteDto, requestId?: string, idempotencyKey?: string) {
    this.validateEurSepaRecipient(dto.iban);
    const providerFee = await this.quoteWiseEurPayoutFee(dto.amount, requestId);

    return this.createWalletPayoutQuote({
      customerId: dto.customerId,
      amount: dto.amount,
      sourceCurrency: WalletCurrency.EUR,
      destinationCurrency: "EUR",
      provider: "wise",
      destinationType: "iban",
      providerFee,
      recipientIban: normalizeIban(dto.iban),
      recipientName: dto.beneficiaryName,
      ...(dto.bankName ? { recipientBankName: dto.bankName } : {}),
      ...(dto.beneficiaryAddress ? { recipientAddress: dto.beneficiaryAddress } : {}),
      ...(idempotencyKey ? { idempotencyKey } : {})
    });
  }

  async createEurWiseTagPayoutQuote(dto: CreateEurWiseTagPayoutQuoteDto, requestId?: string, idempotencyKey?: string) {
    const providerFee = await this.quoteWiseEurPayoutFee(dto.amount, requestId);

    return this.createWalletPayoutQuote({
      customerId: dto.customerId,
      amount: dto.amount,
      sourceCurrency: WalletCurrency.EUR,
      destinationCurrency: "EUR",
      provider: "wise",
      destinationType: "wisetag",
      providerFee,
      recipientWiseTag: dto.wiseTag,
      ...(idempotencyKey ? { idempotencyKey } : {})
    });
  }

  async createUsdcAddressPayoutQuote(dto: CreateUsdcAddressPayoutQuoteDto, idempotencyKey?: string) {
    return this.createWalletPayoutQuote({
      customerId: dto.customerId,
      amount: dto.amount,
      sourceCurrency: WalletCurrency.USDC,
      destinationCurrency: "USDC",
      provider: "kryptapay",
      destinationType: "address",
      providerFee: new Prisma.Decimal(0),
      recipientAddress: dto.address,
      recipientBankName: dto.network,
      ...(idempotencyKey ? { idempotencyKey } : {})
    });
  }

  async confirmEurIbanPayout(dto: ConfirmEurPayoutDto, requestId?: string, idempotencyKey?: string) {
    return this.confirmWalletPayout(dto, WalletCurrency.EUR, "iban", requestId, idempotencyKey);
  }

  async confirmEurWiseTagPayout(dto: ConfirmEurPayoutDto, requestId?: string, idempotencyKey?: string) {
    return this.confirmWalletPayout(dto, WalletCurrency.EUR, "wisetag", requestId, idempotencyKey);
  }

  async confirmUsdcAddressPayout(dto: ConfirmEurPayoutDto, requestId?: string, idempotencyKey?: string) {
    return this.confirmWalletPayout(dto, WalletCurrency.USDC, "address", requestId, idempotencyKey);
  }

  async confirmEurPayout(dto: ConfirmEurPayoutDto, requestId?: string, idempotencyKey?: string) {
    if (!idempotencyKey) {
      throw new BadRequestException("Idempotency-Key is required for payout confirmation");
    }

    const existing = await this.prisma.payout.findUnique({ where: { idempotencyKey } });
    if (existing) {
      return this.toPayoutResponse(existing);
    }

    const reserved = await this.reserveWalletDebit(dto.quoteId, idempotencyKey);

    try {
      const providerPayout = await this.kryptaPay.createPayout(
        {
          amount: reserved.destinationAmount,
          currency: "EUR",
          network: "BANK_EUR",
          recipient: withoutUndefined({
            iban: reserved.recipientIban ?? undefined,
            fullName: reserved.recipientName ?? undefined,
            ...(reserved.recipientBankName ? { bankName: reserved.recipientBankName } : {})
          }),
          description: "EUR SEPA payout"
        },
        {
          requestId,
          idempotencyKey,
          merchantReference: reserved.merchantReference
        }
      );

      const updated = await this.prisma.payout.update({
        where: { id: reserved.payoutId },
        data: {
          status: PayoutStatus.PROCESSING,
          providerReference: providerPayout.reference,
          ...(providerPayout.trace.providerTransactionId
            ? { providerTransactionId: providerPayout.trace.providerTransactionId }
            : {})
        }
      });

      await this.sangapayWebhooks.dispatch(
        "payout.processing",
        {
          customerId: reserved.customerExternalId,
          payoutId: updated.id,
          amount: updated.amount.toFixed(),
          currency: updated.currency,
          status: updated.status.toLowerCase(),
          reference: updated.merchantReference
        },
        requestId
      );

      return this.toPayoutResponse(updated);
    } catch (error) {
      await this.reversePayout(reserved.payoutId, "Provider payout submission failed");
      throw error;
    }
  }

  async getPayoutStatus(id: string) {
    const payout = await this.prisma.payout.findUnique({ where: { id } });

    if (!payout) {
      throw new NotFoundException("Payout not found");
    }

    return this.toPayoutResponse(payout);
  }

  async reconcileProviderPayoutStatus(id: string, requestId?: string) {
    const payout = await this.prisma.payout.findUnique({ where: { id } });

    if (!payout) {
      throw new NotFoundException("Payout not found");
    }

    if (isTerminalPayoutStatus(payout.status)) {
      return { reconciled: false, terminal: true, status: payout.status.toLowerCase() };
    }

    const providerReference = payout.providerReference ?? payout.providerTransactionId;
    if (!providerReference) {
      return { reconciled: false, status: payout.status.toLowerCase(), reason: "missing_provider_reference" };
    }

    if (payout.provider === "wise") {
      const transfer = await this.wise.getTransfer(providerReference, { requestId, merchantReference: payout.merchantReference });
      if (isWiseCompletedState(transfer.status)) {
        await this.markWisePayoutSettled(providerReference, "completed");
        return { reconciled: true, status: PayoutStatus.COMPLETED.toLowerCase() };
      }

      if (isWiseFailedState(transfer.status)) {
        const terminalStatus = transfer.status.toLowerCase().includes("refund") ? "refunded" : "failed";
        await this.markWisePayoutSettled(providerReference, terminalStatus, `Wise transfer ${transfer.status}`);
        return { reconciled: true, status: terminalStatus };
      }

      return { reconciled: false, status: transfer.status };
    }

    const providerPayout = await this.kryptaPay.getPayout(providerReference, {
      requestId,
      merchantReference: payout.merchantReference
    });

    if (providerPayout.status === "completed") {
      await this.markProviderPayoutSettled(providerReference, "completed");
      return { reconciled: true, status: PayoutStatus.COMPLETED.toLowerCase() };
    }

    if (providerPayout.status === "failed" || providerPayout.status === "cancelled" || providerPayout.status === "refunded") {
      const terminalStatus = providerPayout.status === "refunded" ? "refunded" : "failed";
      await this.markProviderPayoutSettled(
        providerReference,
        terminalStatus,
        providerPayout.failureReason ?? `Provider payout ${providerPayout.status}`
      );
      return { reconciled: true, status: terminalStatus };
    }

    return { reconciled: false, status: providerPayout.status };
  }

  private async createWalletPayoutQuote(input: {
    customerId: string;
    amount: string;
    sourceCurrency: PayoutWalletCurrency;
    destinationCurrency: "EUR" | "USDC";
    provider: "wise" | "kryptapay";
    destinationType: "iban" | "wisetag" | "address";
    providerFee: Prisma.Decimal;
    idempotencyKey?: string;
    recipientIban?: string;
    recipientName?: string;
    recipientBankName?: string;
    recipientAddress?: string;
    recipientWiseTag?: string;
  }) {
    if (input.idempotencyKey) {
      const existing = await this.prisma.payoutQuote.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (existing) {
        return this.toQuoteResponse(existing);
      }
    }

    const amount = parseMoneyDecimal(input.amount);
    const reepayFee = this.feeService.calculateCurrencyFeeDecimal(amount, input.sourceCurrency);
    const totalDebit = amount.add(input.providerFee).add(reepayFee).toDecimalPlaces(
      input.sourceCurrency === WalletCurrency.USDC ? 8 : 4
    );
    const now = Date.now();
    const expiresAt = new Date(now + 15 * 60_000);

    const quote = await this.prisma.payoutQuote.create({
      data: {
        customer: {
          connectOrCreate: {
            where: { externalId: input.customerId },
            create: { externalId: input.customerId }
          }
        },
        sourceCurrency: input.sourceCurrency,
        destinationCurrency: input.destinationCurrency,
        destinationAmount: amount,
        sourceAmount: amount,
        providerFee: input.providerFee,
        reepayFee,
        totalDebit,
        rate: new Prisma.Decimal(1),
        providerQuoteExpiresAt: expiresAt,
        expiresAt,
        provider: input.provider,
        destinationType: input.destinationType,
        merchantReference: this.createMerchantReference(`${input.destinationCurrency.toLowerCase()}_${input.destinationType}_quote`),
        ...(input.recipientIban ? { recipientIban: input.recipientIban } : {}),
        ...(input.recipientName ? { recipientName: input.recipientName } : {}),
        ...(input.recipientBankName ? { recipientBankName: input.recipientBankName } : {}),
        ...(input.recipientAddress ? { recipientAddress: input.recipientAddress } : {}),
        ...(input.recipientWiseTag ? { recipientWiseTag: input.recipientWiseTag } : {}),
        ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {})
      }
    });

    return this.toQuoteResponse(quote);
  }

  private async confirmWalletPayout(
    dto: ConfirmEurPayoutDto,
    sourceCurrency: PayoutWalletCurrency,
    destinationType: "iban" | "wisetag" | "address",
    requestId?: string,
    idempotencyKey?: string
  ) {
    if (!idempotencyKey) {
      throw new BadRequestException("Idempotency-Key is required for payout confirmation");
    }

    const existing = await this.prisma.payout.findUnique({ where: { idempotencyKey } });
    if (existing) {
      return this.toPayoutResponse(existing);
    }

    const reserved = await this.reserveWalletCurrencyPayoutDebit(dto.quoteId, sourceCurrency, destinationType, idempotencyKey);

    try {
      const providerResult: SubmittedProviderPayout =
        reserved.provider === "wise"
          ? await this.submitWisePayout(reserved, requestId)
          : await this.submitUsdcAddressPayout(reserved, requestId, idempotencyKey);

      const updated = await this.prisma.payout.update({
        where: { id: reserved.payoutId },
        data: {
          status: PayoutStatus.PROCESSING,
          providerReference: providerResult.reference,
          providerTransactionId: providerResult.id,
          ...(providerResult.providerCost ? { providerCost: providerResult.providerCost } : {})
        }
      });

      await this.sangapayWebhooks.dispatch(
        "payout.processing",
        {
          customerId: reserved.customerExternalId,
          payoutId: updated.id,
          amount: updated.amount.toFixed(),
          currency: updated.currency,
          sourceCurrency: updated.sourceCurrency,
          destinationType: updated.destinationType,
          status: updated.status.toLowerCase(),
          reference: updated.merchantReference
        },
        requestId
      );

      return this.toPayoutResponse(updated);
    } catch (error) {
      await this.reversePayout(reserved.payoutId, "Provider payout submission failed");
      throw error;
    }
  }

  private async reserveWalletCurrencyPayoutDebit(
    quoteId: string,
    sourceCurrency: PayoutWalletCurrency,
    destinationType: "iban" | "wisetag" | "address",
    idempotencyKey: string
  ): Promise<ReservedWalletPayout> {
    return this.prisma.$transaction(async (tx) => {
      const quote = await tx.payoutQuote.findUnique({
        where: { id: quoteId },
        include: { customer: true }
      });

      if (!quote) {
        throw new NotFoundException("Payout quote not found");
      }

      if (quote.sourceCurrency !== sourceCurrency || quote.destinationType !== destinationType) {
        throw new BadRequestException("Payout quote does not match endpoint");
      }

      if (quote.expiresAt.getTime() <= Date.now()) {
        throw new ConflictException("Payout quote has expired");
      }

      if (quote.confirmedAt) {
        throw new ConflictException("Payout quote has already been confirmed");
      }

      const wallet = await tx.wallet.findUnique({
        where: {
          customerId_currency: {
            customerId: quote.customerId,
            currency: sourceCurrency
          }
        }
      });

      if (!wallet || wallet.balance.lessThan(quote.totalDebit)) {
        throw new ConflictException(`Insufficient ${sourceCurrency} wallet balance`);
      }

      const updatedWallet = await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          balance: {
            decrement: quote.totalDebit
          }
        }
      });

      const payout = await tx.payout.create({
        data: {
          customerId: quote.customerId,
          walletId: wallet.id,
          quoteId: quote.id,
          amount: quote.destinationAmount,
          currency: quote.destinationCurrency,
          sourceAmount: quote.sourceAmount,
          sourceCurrency,
          providerFee: quote.providerFee,
          reepayFee: quote.reepayFee,
          totalDebit: quote.totalDebit,
          status: PayoutStatus.PENDING,
          merchantReference: quote.merchantReference,
          idempotencyKey,
          provider: quote.provider,
          destinationType: quote.destinationType,
          ...(quote.recipientIban ? { recipientIban: quote.recipientIban } : {}),
          ...(quote.recipientName ? { recipientName: quote.recipientName } : {}),
          ...(quote.recipientBankName ? { recipientBankName: quote.recipientBankName } : {}),
          ...(quote.recipientAddress ? { recipientAddress: quote.recipientAddress } : {}),
          ...(quote.recipientWiseTag ? { recipientWiseTag: quote.recipientWiseTag } : {})
        }
      });

      const transaction = await tx.transaction.create({
        data: {
          customerId: quote.customerId,
          payoutId: payout.id,
          type: sourceCurrency === WalletCurrency.USDC ? TransactionType.USDC_PAYOUT : TransactionType.EUR_PAYOUT,
          status: TransactionStatus.PROCESSING,
          amount: quote.totalDebit,
          currency: sourceCurrency,
          provider: quote.provider,
          merchantReference: quote.merchantReference
        }
      });

      await tx.ledgerEntry.create({
        data: {
          walletId: wallet.id,
          customerId: quote.customerId,
          transactionId: transaction.id,
          type: "DEBIT",
          amount: quote.totalDebit,
          currency: sourceCurrency,
          balanceAfter: updatedWallet.balance,
          description: `${sourceCurrency} payout debit`
        }
      });

      await tx.payoutQuote.update({
        where: { id: quote.id },
        data: { confirmedAt: new Date() }
      });

      await tx.notificationEvent.create({
        data: {
          customerId: quote.customerId,
          type: "PAYOUT_PROCESSING",
          payload: {
            payoutId: payout.id,
            transactionId: transaction.id,
            amount: quote.destinationAmount.toFixed(),
            currency: quote.destinationCurrency,
            debitedAmount: quote.totalDebit.toFixed(),
            debitedCurrency: sourceCurrency,
            destinationType: quote.destinationType
          }
        }
      });

      return {
        payoutId: payout.id,
        customerExternalId: quote.customer.externalId,
        merchantReference: payout.merchantReference,
        provider: payout.provider,
        destinationType: payout.destinationType,
        amount: payout.amount.toFixed(),
        currency: payout.currency,
        sourceCurrency: payout.sourceCurrency,
        recipientIban: payout.recipientIban,
        recipientName: payout.recipientName,
        recipientBankName: payout.recipientBankName,
        recipientAddress: payout.recipientAddress,
        recipientWiseTag: payout.recipientWiseTag,
        providerFee: payout.providerFee.toFixed()
      };
    });
  }

  private async quoteWiseEurPayoutFee(amount: string, requestId?: string) {
    const quote = await this.wise.createEurBalancePayoutQuote({ amount }, { requestId });
    return parseMoneyDecimal(quote.fee).toDecimalPlaces(4);
  }

  private async submitWisePayout(
    payout: ReservedWalletPayout,
    requestId?: string
  ): Promise<SubmittedProviderPayout> {
    const recipient =
      payout.destinationType === "wisetag"
        ? await this.wise.createWiseTagContact({ wiseTag: payout.recipientWiseTag ?? "" }, { requestId })
        : await this.wise.createIbanRecipient(
            {
              iban: payout.recipientIban ?? "",
              accountHolderName: payout.recipientName ?? "SangaPay recipient"
            },
            { requestId }
          );
    const quote = await this.wise.createEurBalancePayoutQuote(
      {
        amount: payout.amount,
        ...(payout.destinationType === "wisetag" ? { contactId: recipient.id } : { targetAccount: recipient.id })
      },
      { requestId }
    );
    const finalProviderFee = parseMoneyDecimal(quote.fee).toDecimalPlaces(4);
    if (!finalProviderFee.equals(new Prisma.Decimal(payout.providerFee))) {
      throw new ConflictException("Provider payout fee changed; create a new payout quote");
    }

    const transfer = await this.wise.createTransfer(
      {
        targetAccount: recipient.id,
        quoteId: quote.id,
        customerTransactionId: randomUUID(),
        reference: payout.merchantReference
      },
      { requestId, merchantReference: payout.merchantReference }
    );
    const funded = await this.wise.fundTransfer(transfer.id, { requestId, merchantReference: payout.merchantReference });

    return {
      id: funded.id,
      reference: funded.reference ?? transfer.id
    };
  }

  private async submitUsdcAddressPayout(
    payout: ReservedWalletPayout,
    requestId?: string,
    idempotencyKey?: string
  ): Promise<SubmittedProviderPayout> {
    const providerPayout = await this.kryptaPay.createPayout(
      {
        amount: payout.amount,
        currency: "USDC",
        network: payout.recipientBankName as never,
        recipient: {
          address: payout.recipientAddress ?? "",
          chain: payout.recipientBankName as never
        },
        description: "USDC address payout"
      },
      {
        requestId,
        idempotencyKey,
        merchantReference: payout.merchantReference
      }
    );

    return {
      id: providerPayout.trace.providerTransactionId ?? providerPayout.id,
      reference: providerPayout.reference,
      providerCost: providerPayout.fee ? parseMoneyDecimal(providerPayout.fee) : new Prisma.Decimal(0)
    };
  }

  private async reserveWalletDebit(quoteId: string, idempotencyKey: string) {
    return this.prisma.$transaction(async (tx) => {
      const quote = await tx.payoutQuote.findUnique({
        where: { id: quoteId },
        include: { customer: true }
      });

      if (!quote) {
        throw new NotFoundException("Payout quote not found");
      }

      if (quote.expiresAt.getTime() <= Date.now()) {
        throw new ConflictException("Payout quote has expired");
      }

      if (quote.confirmedAt) {
        throw new ConflictException("Payout quote has already been confirmed");
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

      const payout = await tx.payout.create({
        data: {
          customerId: quote.customerId,
          walletId: wallet.id,
          quoteId: quote.id,
          amount: quote.destinationAmount,
          currency: "EUR",
          sourceAmount: quote.sourceAmount,
          providerFee: quote.providerFee,
          reepayFee: quote.reepayFee,
          totalDebit: quote.totalDebit,
          status: PayoutStatus.PENDING,
          merchantReference: quote.merchantReference,
          idempotencyKey,
          provider: "kryptapay",
          recipientIban: quote.recipientIban,
          recipientName: quote.recipientName,
          ...(quote.recipientBankName ? { recipientBankName: quote.recipientBankName } : {}),
          ...(quote.recipientAddress ? { recipientAddress: quote.recipientAddress } : {})
        }
      });

      const transaction = await tx.transaction.create({
        data: {
          customerId: quote.customerId,
          payoutId: payout.id,
          type: TransactionType.EUR_PAYOUT,
          status: TransactionStatus.PROCESSING,
          amount: quote.totalDebit,
          currency: WalletCurrency.XAF,
          provider: "kryptapay",
          merchantReference: quote.merchantReference
        }
      });

      await tx.ledgerEntry.create({
        data: {
          walletId: wallet.id,
          customerId: quote.customerId,
          transactionId: transaction.id,
          type: "DEBIT",
          amount: quote.totalDebit,
          currency: WalletCurrency.XAF,
          balanceAfter: updatedWallet.balance,
          description: "EUR payout debit"
        }
      });

      await tx.payoutQuote.update({
        where: { id: quote.id },
        data: { confirmedAt: new Date() }
      });

      await tx.notificationEvent.create({
        data: {
          customerId: quote.customerId,
          type: "PAYOUT_PROCESSING",
          payload: {
            payoutId: payout.id,
            transactionId: transaction.id,
            amount: quote.destinationAmount.toFixed(),
            currency: "EUR",
            debitedAmount: quote.totalDebit.toFixed(),
            debitedCurrency: WalletCurrency.XAF
          }
        }
      });

      return {
        payoutId: payout.id,
        customerExternalId: quote.customer.externalId,
        merchantReference: payout.merchantReference,
        destinationAmount: quote.destinationAmount.toFixed(),
        recipientIban: quote.recipientIban,
        recipientName: quote.recipientName,
        recipientBankName: quote.recipientBankName
      };
    });
  }

  async markProviderPayoutSettled(providerReference: string, status: "completed" | "failed" | "refunded", failureReason?: string) {
    const providerPayout = await this.kryptaPay.getPayout(providerReference, {
      merchantReference: this.createMerchantReference("payout_status")
    });
    const providerTransactionId = providerPayout.trace.providerTransactionId;
    const payout = await this.prisma.payout.findFirst({
      where: {
        OR: [
          { providerReference },
          { providerReference: providerPayout.reference },
          ...(providerTransactionId ? [{ providerTransactionId }] : [])
        ]
      },
      include: { customer: true }
    });

    if (!payout) {
      throw new NotFoundException("Payout not found for provider reference");
    }

    const providerCost = providerPayout.fee ? parseMoneyDecimal(providerPayout.fee) : undefined;

    if (providerCost && !providerCost.equals(payout.providerCost)) {
      await this.prisma.payout.update({
        where: { id: payout.id },
        data: { providerCost }
      });
    }

    if (status === "completed" && providerPayout.status === "completed") {
      const eventPayload = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.payout.updateMany({
          where: { id: payout.id, status: { not: PayoutStatus.COMPLETED } },
          data: {
            status: PayoutStatus.COMPLETED,
            completedAt: new Date(),
            ...(providerCost ? { providerCost } : {})
          }
        });

        if (updated.count === 0) {
          return undefined;
        }

        await tx.transaction.updateMany({
          where: { payoutId: payout.id },
          data: { status: TransactionStatus.COMPLETED }
        });

        if (payout.reepayFee.greaterThan(0)) {
          await tx.reepayFeeEarning.createMany({
            data: [
              {
                sourceType: "PAYOUT",
                sourceId: payout.id,
                amount: payout.reepayFee,
                currency: payout.sourceCurrency,
                payoutId: payout.id
              }
            ],
            skipDuplicates: true
          });
        }

        await tx.notificationEvent.create({
          data: {
            customerId: payout.customerId,
            type: "PAYOUT_COMPLETED",
            payload: { payoutId: payout.id, amount: payout.amount.toFixed(), currency: payout.currency }
          }
        });

        return {
          customerId: payout.customer.externalId,
          payoutId: payout.id,
          amount: payout.amount.toFixed(),
          currency: payout.currency,
          status: PayoutStatus.COMPLETED.toLowerCase(),
          reference: payout.merchantReference
        };
      });

      if (eventPayload) {
        await this.sangapayWebhooks.dispatch("payout.completed", eventPayload);
      }
      return;
    }

    if (status === "failed" || status === "refunded" || providerPayout.status === "failed" || providerPayout.status === "refunded") {
      const terminalStatus =
        status === "refunded" || providerPayout.status === "refunded" ? PayoutStatus.REFUNDED : PayoutStatus.FAILED;
      await this.reversePayout(
        payout.id,
        failureReason ?? providerPayout.failureReason ?? "Provider payout did not complete",
        terminalStatus
      );
    }
  }

  async markWisePayoutSettled(transferReference: string, status: "completed" | "failed" | "refunded", failureReason?: string) {
    const transfer = await this.wise.getTransfer(transferReference).catch(() => undefined);
    const providerReferences = Array.from(
      new Set([
        transferReference,
        transfer?.id,
        transfer?.reference
      ].filter((reference): reference is string => Boolean(reference)))
    );

    const payout = await this.prisma.payout.findFirst({
      where: {
        provider: "wise",
        OR: providerReferences.flatMap((reference) => [
          { providerReference: reference },
          { providerTransactionId: reference }
        ])
      },
      include: { customer: true }
    });

    if (!payout) {
      throw new NotFoundException("Wise payout not found for transfer reference");
    }

    if (status === "completed" && (!transfer || isWiseCompletedState(transfer.status))) {
      const eventPayload = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.payout.updateMany({
          where: { id: payout.id, status: { not: PayoutStatus.COMPLETED } },
          data: {
            status: PayoutStatus.COMPLETED,
            completedAt: new Date(),
            ...(transfer?.id ? { providerTransactionId: transfer.id } : {}),
            ...(transfer?.reference ? { providerReference: transfer.reference } : {})
          }
        });

        if (updated.count === 0) {
          return undefined;
        }

        await tx.transaction.updateMany({
          where: { payoutId: payout.id },
          data: { status: TransactionStatus.COMPLETED }
        });

        if (payout.reepayFee.greaterThan(0)) {
          await tx.reepayFeeEarning.createMany({
            data: [
              {
                sourceType: "PAYOUT",
                sourceId: payout.id,
                amount: payout.reepayFee,
                currency: payout.sourceCurrency,
                payoutId: payout.id
              }
            ],
            skipDuplicates: true
          });
        }

        await tx.notificationEvent.create({
          data: {
            customerId: payout.customerId,
            type: "PAYOUT_COMPLETED",
            payload: { payoutId: payout.id, amount: payout.amount.toFixed(), currency: payout.currency }
          }
        });

        return {
          customerId: payout.customer.externalId,
          payoutId: payout.id,
          amount: payout.amount.toFixed(),
          currency: payout.currency,
          status: PayoutStatus.COMPLETED.toLowerCase(),
          reference: payout.merchantReference
        };
      });

      if (eventPayload) {
        await this.sangapayWebhooks.dispatch("payout.completed", eventPayload);
      }
      return;
    }

    if (status === "failed" || status === "refunded" || (transfer && isWiseFailedState(transfer.status))) {
      const terminalStatus = status === "refunded" ? PayoutStatus.REFUNDED : PayoutStatus.FAILED;
      await this.reversePayout(
        payout.id,
        failureReason ?? `Wise transfer ${transfer?.status ?? status}`,
        terminalStatus
      );
    }
  }

  private async reversePayout(
    payoutId: string,
    reason: string,
    terminalStatus: PayoutStatus = PayoutStatus.FAILED
  ) {
    const eventPayload = await this.prisma.$transaction(async (tx) => {
      const payout = await tx.payout.findUnique({ where: { id: payoutId }, include: { customer: true } });

      if (!payout) {
        throw new NotFoundException("Payout not found");
      }

      const updated = await tx.payout.updateMany({
        where: { id: payout.id, reversedAt: null },
        data: {
          status: terminalStatus,
          failureReason: reason,
          reversedAt: new Date()
        }
      });

      if (updated.count === 0) {
        return;
      }

      const wallet = await tx.wallet.update({
        where: { id: payout.walletId },
        data: {
          balance: {
            increment: payout.totalDebit
          }
        }
      });

      const reversal = await tx.transaction.create({
        data: {
          customerId: payout.customerId,
          payoutId: payout.id,
          type: TransactionType.PAYOUT_REVERSAL,
          status: TransactionStatus.COMPLETED,
          amount: payout.totalDebit,
          currency: payout.sourceCurrency,
          provider: payout.provider,
          providerReference: payout.providerReference,
          providerTransactionId: payout.providerTransactionId,
          merchantReference: `${payout.merchantReference}_reversal`
        }
      });

      await tx.ledgerEntry.create({
        data: {
          walletId: payout.walletId,
          customerId: payout.customerId,
          transactionId: reversal.id,
          type: "CREDIT",
          amount: payout.totalDebit,
          currency: payout.sourceCurrency,
          balanceAfter: wallet.balance,
          description: `${payout.sourceCurrency} payout reversal`
        }
      });

      await tx.transaction.updateMany({
        where: { payoutId: payout.id },
        data: {
          status: terminalStatus === PayoutStatus.REFUNDED ? TransactionStatus.REFUNDED : TransactionStatus.FAILED
        }
      });

      await tx.notificationEvent.create({
        data: {
          customerId: payout.customerId,
          type: terminalStatus === PayoutStatus.REFUNDED ? "PAYOUT_REFUNDED" : "PAYOUT_FAILED",
          payload: {
            payoutId: payout.id,
            reason,
            reversedAmount: payout.totalDebit.toFixed(),
            reversedCurrency: payout.sourceCurrency
          }
        }
      });

      return {
        customerId: payout.customer.externalId,
        payoutId: payout.id,
        amount: payout.amount.toFixed(),
        currency: payout.currency,
        status: terminalStatus.toLowerCase(),
        reference: payout.merchantReference,
        reason,
        reversedAmount: payout.totalDebit.toFixed(),
        reversedCurrency: payout.sourceCurrency
      };
    });

    const eventType = terminalStatus === PayoutStatus.REFUNDED ? "payout.refunded" : "payout.failed";
    if (eventPayload) {
      await this.sangapayWebhooks.dispatch(eventType, eventPayload);
    }
  }

  private validateEurSepaRecipient(iban: string) {
    if (!sepaIbanPattern.test(normalizeIban(iban))) {
      throw new BadRequestException("A valid EUR SEPA IBAN is required");
    }
  }

  private createMerchantReference(prefix: string) {
    return `rp_${prefix}_${Date.now().toString(36)}_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  }

  private toQuoteResponse(quote: {
    id: string;
    sourceCurrency: WalletCurrency;
    destinationCurrency: string;
    destinationAmount: Prisma.Decimal;
    sourceAmount: Prisma.Decimal;
    providerFee: Prisma.Decimal;
    reepayFee: Prisma.Decimal;
    totalDebit: Prisma.Decimal;
    rate: Prisma.Decimal;
    quotedAt: Date;
    expiresAt: Date;
    provider?: string;
    destinationType?: string;
    recipientIban: string | null;
    recipientName: string | null;
    recipientWiseTag?: string | null;
  }) {
    const totalFee = quote.providerFee.add(quote.reepayFee);

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
        provider: { amount: quote.providerFee.toFixed(), currency: quote.sourceCurrency },
        reepay: { amount: quote.reepayFee.toFixed(), currency: quote.sourceCurrency }
      },
      totalFee: {
        amount: totalFee.toFixed(),
        currency: quote.sourceCurrency
      },
      totalDebit: {
        amount: quote.totalDebit.toFixed(),
        currency: quote.sourceCurrency
      },
      rate: quote.rate.toFixed(),
      quotedAt: quote.quotedAt.toISOString(),
      expiresAt: quote.expiresAt.toISOString(),
      recipient: {
        iban: quote.recipientIban ?? undefined,
        name: quote.recipientName ?? undefined,
        wiseTag: quote.recipientWiseTag ?? undefined,
        type: quote.destinationType ?? "iban"
      },
      provider: quote.provider
    };
  }

  private toPayoutResponse(payout: {
    id: string;
    status: PayoutStatus;
    amount: Prisma.Decimal;
    currency: string;
    sourceCurrency?: WalletCurrency;
    totalDebit: Prisma.Decimal;
    providerReference: string | null;
    providerTransactionId: string | null;
    merchantReference: string;
    createdAt: Date;
    updatedAt: Date;
    completedAt: Date | null;
  }) {
    return {
      id: payout.id,
      status: payout.status.toLowerCase(),
      destination: {
        amount: payout.amount.toFixed(),
        currency: payout.currency
      },
      debited: {
        amount: payout.totalDebit.toFixed(),
        currency: payout.sourceCurrency ?? WalletCurrency.XAF
      },
      reference: payout.merchantReference,
      createdAt: payout.createdAt.toISOString(),
      updatedAt: payout.updatedAt.toISOString(),
      completedAt: payout.completedAt?.toISOString()
    };
  }
}

function normalizeIban(iban: string) {
  return iban.replace(/\s/g, "").toUpperCase();
}

function withoutUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

function isWiseCompletedState(status: string) {
  return ["outgoing_payment_sent", "funds_converted", "completed", "sent", "success"].includes(status.toLowerCase());
}

function isWiseFailedState(status: string) {
  return ["bounced_back", "cancelled", "failed", "funds_refunded", "refunded"].includes(status.toLowerCase());
}

function isTerminalPayoutStatus(status: PayoutStatus) {
  switch (status) {
    case PayoutStatus.COMPLETED:
    case PayoutStatus.FAILED:
    case PayoutStatus.CANCELLED:
    case PayoutStatus.REFUNDED:
      return true;
    default:
      return false;
  }
}
