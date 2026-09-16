import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException
} from "@nestjs/common";
import {
  DepositStatus,
  LedgerEntryType,
  NotificationEventType,
  Prisma,
  TransactionStatus,
  TransactionType,
  WalletCurrency,
  WebhookProcessingStatus
} from "@prisma/client";
import { createHmac, timingSafeEqual } from "node:crypto";
import { parseMoneyDecimal } from "../../common/money/decimal";
import { AppConfigService } from "../../config/app-config.service";
import { PrismaService } from "../../database/prisma.service";
import { PayoutsService } from "../../payouts";
import { KryptaPayClient } from "../../providers/kryptapay";
import { WalletConversionsService } from "../../wallets/wallet-conversions.service";
import { SangaPayWebhookDispatcher } from "../sangapay";
import type { KryptaPayWebhookEventType, KryptaPayWebhookPayload } from "./kryptapay-webhook.types";

type KryptaPayWebhookHeaders = {
  signature?: string | undefined;
  eventType?: string | undefined;
  eventId?: string | undefined;
  requestId?: string | undefined;
};

@Injectable()
export class KryptaPayWebhookService {
  constructor(
    @Inject(AppConfigService) private readonly config: AppConfigService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(KryptaPayClient) private readonly kryptaPay: KryptaPayClient,
    @Inject(PayoutsService) private readonly payouts: PayoutsService,
    @Inject(SangaPayWebhookDispatcher) private readonly sangapayWebhooks: SangaPayWebhookDispatcher,
    @Inject(WalletConversionsService) private readonly walletConversions: WalletConversionsService
  ) {}

  async acceptWebhook(rawBody: Buffer, headers: KryptaPayWebhookHeaders) {
    this.assertRequiredHeaders(headers);
    const signatureValid = this.verifySignature(rawBody, headers.signature);

    if (!signatureValid) {
      await this.createInvalidWebhookLog(rawBody, headers);
      throw new UnauthorizedException("Invalid KryptaPay webhook signature");
    }

    const created = await this.createWebhookLog(rawBody, headers);
    if (!created) {
      return { received: true, duplicate: true };
    }

    const payload = await this.parseVerifiedPayload(rawBody, headers);

    void this.processAcceptedWebhook(headers.eventId as string, payload, headers.requestId).catch(async (error: unknown) => {
      try {
        await this.markWebhookFailed(headers.eventId as string, error);
      } catch {
        // The webhook log already exists; avoid surfacing a background rejection to the HTTP lifecycle.
      }
    });

    return { received: true };
  }

  async handleWebhook(payload: KryptaPayWebhookPayload, rawBody: Buffer, signature?: string, requestId?: string) {
    const headers = {
      signature,
      eventType: payload.event_type,
      eventId: payload.event_id,
      requestId
    };
    this.assertRequiredHeaders(headers);

    if (!this.verifySignature(rawBody, signature)) {
      await this.createInvalidWebhookLog(rawBody, headers);
      throw new UnauthorizedException("Invalid KryptaPay webhook signature");
    }

    const created = await this.createWebhookLog(rawBody, headers);
    if (!created) {
      return { received: true, duplicate: true };
    }

    const verifiedPayload = await this.parseVerifiedPayload(rawBody, headers);
    await this.processAcceptedWebhook(payload.event_id, verifiedPayload, requestId);
    return { received: true };
  }

  private assertRequiredHeaders(headers: KryptaPayWebhookHeaders) {
    if (!headers.signature || !headers.eventType || !headers.eventId) {
      throw new BadRequestException(
        "X-KryptaPay-Signature, X-KryptaPay-Event, and X-KryptaPay-Event-Id are required"
      );
    }
  }

  private verifySignature(rawBody: Buffer, signature?: string) {
    if (!signature) {
      return false;
    }

    const expected = createHmac("sha256", this.config.kryptapay.webhookSecret).update(rawBody).digest("hex");
    const receivedBuffer = Buffer.from(signature, "hex");
    const expectedBuffer = Buffer.from(expected, "hex");

    return receivedBuffer.length === expectedBuffer.length && timingSafeEqual(receivedBuffer, expectedBuffer);
  }

  private async createInvalidWebhookLog(rawBody: Buffer, headers: KryptaPayWebhookHeaders) {
    if (!headers.eventId || !headers.eventType) {
      return;
    }

    await this.createWebhookLog(rawBody, headers, false, WebhookProcessingStatus.FAILED, "Invalid signature");
  }

  private async createWebhookLog(
    rawBody: Buffer,
    headers: KryptaPayWebhookHeaders,
    signatureValid = true,
    processingStatus: WebhookProcessingStatus = WebhookProcessingStatus.PENDING,
    errorMessage?: string
  ) {
    try {
      await this.prisma.webhookLog.create({
        data: {
          provider: "kryptapay",
          eventId: headers.eventId as string,
          eventType: headers.eventType as string,
          signatureValid,
          rawPayload: rawBody.toString("utf8"),
          processingStatus,
          ...(headers.requestId ? { providerRequestId: headers.requestId } : {}),
          ...(errorMessage ? { errorMessage } : {})
        }
      });
      return true;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return false;
      }

      throw error;
    }
  }

  private async parseVerifiedPayload(rawBody: Buffer, headers: KryptaPayWebhookHeaders) {
    let payload: KryptaPayWebhookPayload;

    try {
      payload = JSON.parse(rawBody.toString("utf8")) as KryptaPayWebhookPayload;
    } catch (error) {
      await this.markWebhookFailed(headers.eventId as string, error);
      throw new BadRequestException("Invalid KryptaPay webhook JSON payload");
    }

    if (payload.event_id !== headers.eventId || payload.event_type !== headers.eventType) {
      await this.markWebhookFailed(headers.eventId as string, new Error("Webhook headers do not match payload"));
      throw new BadRequestException("KryptaPay webhook headers do not match payload");
    }

    return payload;
  }

  private async processAcceptedWebhook(eventId: string, payload: KryptaPayWebhookPayload, requestId?: string) {
    await this.prisma.webhookLog.update({
      where: { provider_eventId: { provider: "kryptapay", eventId } },
      data: {
        processingStatus: WebhookProcessingStatus.PROCESSING,
        providerReference: payload.data.reference
      }
    });

    switch (payload.event_type) {
      case "PAYIN_RECEIVED":
        await this.processPayinReceived(payload, requestId);
        break;
      case "PAYIN_FAILED":
        await this.processPayinFailed(payload, requestId);
        break;
      case "PAYOUT_COMPLETED":
        if (!(await this.walletConversions.tryMarkProviderConversionSettled(payload.data.reference, requestId))) {
          await this.payouts.markProviderPayoutSettled(payload.data.reference, "completed");
        }
        await this.markWebhookProcessed(eventId);
        break;
      case "PAYOUT_FAILED":
      case "PAYOUT_CANCELLED":
        if (
          !(await this.walletConversions.tryMarkProviderConversionFailed(
            payload.data.reference,
            payload.data.failure_reason ?? "Provider wallet conversion payout failed"
          ))
        ) {
          await this.payouts.markProviderPayoutSettled(
            payload.data.reference,
            "failed",
            payload.data.failure_reason ?? "Provider payout failed"
          );
        }
        await this.markWebhookProcessed(eventId);
        break;
      case "PAYOUT_REFUNDED":
        if (
          !(await this.walletConversions.tryMarkProviderConversionFailed(
            payload.data.reference,
            payload.data.failure_reason ?? "Provider wallet conversion payout refunded"
          ))
        ) {
          await this.payouts.markProviderPayoutSettled(
            payload.data.reference,
            "refunded",
            payload.data.failure_reason ?? "Provider payout refunded"
          );
        }
        await this.markWebhookProcessed(eventId);
        break;
      case "PAYIN_CREATED":
      case "PAYOUT_CREATED":
        await this.markWebhookProcessed(eventId);
        break;
      case "CONVERSION_COMPLETED":
        await this.walletConversions.markProviderConversionSettled(payload.data.reference, requestId);
        await this.markWebhookProcessed(eventId);
        break;
      default:
        assertUnhandledEvent(payload.event_type);
    }
  }

  private async processPayinReceived(payload: KryptaPayWebhookPayload, requestId?: string) {
    const providerReference = payload.data.reference;
    const verified = await this.kryptaPay.getPayinStatus(providerReference, {
      requestId,
      merchantReference: `rp_webhook_${payload.event_id}`
    });

    if (verified.status !== "completed") {
      throw new ConflictException("Provider payin is not completed");
    }

    if (verified.currency !== "XAF") {
      throw new BadRequestException("Only XAF wallet deposits are supported");
    }

    const verifiedAmount = parseMoneyDecimal(verified.amount);

    const eventPayload = await this.prisma.$transaction(async (tx) => {
      const deposit = await tx.deposit.findUnique({
        where: { providerReference },
        include: { customer: true }
      });

      if (!deposit) {
        throw new NotFoundException("Pending deposit not found for provider reference");
      }

      if (!deposit.totalDebit.equals(verifiedAmount) || deposit.currency !== WalletCurrency.XAF) {
        throw new BadRequestException("Verified provider transaction does not match pending deposit");
      }

      if (deposit.status === DepositStatus.COMPLETED) {
        await tx.webhookLog.update({
          where: { provider_eventId: { provider: "kryptapay", eventId: payload.event_id } },
          data: { processingStatus: WebhookProcessingStatus.PROCESSED, processedAt: new Date() }
        });
        return undefined;
      }

      if (deposit.status !== DepositStatus.PENDING && deposit.status !== DepositStatus.PROCESSING) {
        throw new ConflictException("Deposit is not creditable");
      }

      const wallet = await tx.wallet.upsert({
        where: {
          customerId_currency: {
            customerId: deposit.customerId,
            currency: WalletCurrency.XAF
          }
        },
        create: {
          customerId: deposit.customerId,
          currency: WalletCurrency.XAF,
          balance: deposit.amount
        },
        update: {
          balance: {
            increment: deposit.amount
          }
        }
      });

      const transaction = await tx.transaction.create({
        data: {
          customerId: deposit.customerId,
          depositId: deposit.id,
          type: TransactionType.WALLET_FUNDING,
          status: TransactionStatus.COMPLETED,
          amount: deposit.amount,
          currency: WalletCurrency.XAF,
          provider: "kryptapay",
          providerReference: deposit.providerReference,
          providerTransactionId: verified.trace.providerTransactionId ?? payload.data.transaction_id,
          merchantReference: deposit.merchantReference
        }
      });

      await tx.ledgerEntry.create({
        data: {
          walletId: wallet.id,
          customerId: deposit.customerId,
          depositId: deposit.id,
          transactionId: transaction.id,
          type: LedgerEntryType.CREDIT,
          amount: deposit.amount,
          currency: WalletCurrency.XAF,
          balanceAfter: wallet.balance,
          description: "XAF wallet funding"
        }
      });

      if (deposit.reepayFee.greaterThan(0)) {
        await tx.reepayFeeEarning.createMany({
          data: [
            {
              sourceType: "DEPOSIT",
              sourceId: deposit.id,
              amount: deposit.reepayFee,
              currency: WalletCurrency.XAF,
              depositId: deposit.id
            }
          ],
          skipDuplicates: true
        });
      }

      await tx.deposit.update({
        where: { id: deposit.id },
        data: {
          walletId: wallet.id,
          status: DepositStatus.COMPLETED,
          providerTransactionId: verified.trace.providerTransactionId ?? payload.data.transaction_id,
          completedAt: new Date()
        }
      });

      await tx.notificationEvent.create({
        data: {
          customerId: deposit.customerId,
          type: NotificationEventType.DEPOSIT_COMPLETED,
          payload: {
            depositId: deposit.id,
            transactionId: transaction.id,
            amount: deposit.amount.toFixed(),
            currency: WalletCurrency.XAF
          }
        }
      });

      await tx.webhookLog.update({
        where: { provider_eventId: { provider: "kryptapay", eventId: payload.event_id } },
        data: { processingStatus: WebhookProcessingStatus.PROCESSED, processedAt: new Date() }
      });

      return {
        customerId: deposit.customer.externalId,
        depositId: deposit.id,
        transactionId: transaction.id,
        amount: deposit.amount.toFixed(),
        currency: WalletCurrency.XAF,
        status: DepositStatus.COMPLETED.toLowerCase(),
        reference: deposit.merchantReference
      };
    });

    if (eventPayload) {
      await this.sangapayWebhooks.dispatch("deposit.completed", eventPayload, requestId);
    }
  }

  private async processPayinFailed(payload: KryptaPayWebhookPayload, requestId?: string) {
    const eventPayload = await this.prisma.$transaction(async (tx) => {
      const deposit = await tx.deposit.findUnique({
        where: { providerReference: payload.data.reference },
        include: { customer: true }
      });

      if (!deposit) {
        throw new NotFoundException("Deposit not found for provider reference");
      }

      if (deposit.status !== DepositStatus.COMPLETED && deposit.status !== DepositStatus.FAILED) {
        await tx.deposit.update({
          where: { id: deposit.id },
          data: {
            status: DepositStatus.FAILED,
            failureReason: payload.data.failure_reason ?? "Provider reported failed payin"
          }
        });

        await tx.notificationEvent.create({
          data: {
            customerId: deposit.customerId,
            type: NotificationEventType.DEPOSIT_FAILED,
            payload: {
              depositId: deposit.id,
              amount: deposit.amount.toFixed(),
              currency: deposit.currency,
              reason: payload.data.failure_reason ?? "Provider reported failed payin"
            }
          }
        });

        await tx.webhookLog.update({
          where: { provider_eventId: { provider: "kryptapay", eventId: payload.event_id } },
          data: { processingStatus: WebhookProcessingStatus.PROCESSED, processedAt: new Date() }
        });

        return {
          customerId: deposit.customer.externalId,
          depositId: deposit.id,
          amount: deposit.amount.toFixed(),
          currency: deposit.currency,
          status: DepositStatus.FAILED.toLowerCase(),
          reference: deposit.merchantReference,
          reason: payload.data.failure_reason ?? "Provider reported failed payin"
        };
      }

      await tx.webhookLog.update({
        where: { provider_eventId: { provider: "kryptapay", eventId: payload.event_id } },
        data: { processingStatus: WebhookProcessingStatus.PROCESSED, processedAt: new Date() }
      });

      return undefined;
    });

    if (eventPayload) {
      await this.sangapayWebhooks.dispatch("deposit.failed", eventPayload, requestId);
    }
  }

  private async markWebhookProcessed(eventId: string) {
    await this.prisma.webhookLog.update({
      where: { provider_eventId: { provider: "kryptapay", eventId } },
      data: { processingStatus: WebhookProcessingStatus.PROCESSED, processedAt: new Date() }
    });
  }

  private async markWebhookFailed(eventId: string, error: unknown) {
    await this.prisma.webhookLog.update({
      where: { provider_eventId: { provider: "kryptapay", eventId } },
      data: {
        processingStatus: WebhookProcessingStatus.FAILED,
        errorMessage: error instanceof Error ? error.message : "Webhook processing failed",
        processedAt: new Date()
      }
    });
  }
}

function assertUnhandledEvent(eventType: KryptaPayWebhookEventType): never {
  throw new BadRequestException(`Unsupported KryptaPay webhook event: ${eventType}`);
}
