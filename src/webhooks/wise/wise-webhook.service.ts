import { BadRequestException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { Prisma, WebhookProcessingStatus } from "@prisma/client";
import { createVerify } from "node:crypto";
import { AppConfigService } from "../../config/app-config.service";
import { PrismaService } from "../../database/prisma.service";
import { PayoutsService } from "../../payouts";
import type { WiseWebhookHeaders, WiseWebhookPayload } from "./wise-webhook.types";

@Injectable()
export class WiseWebhookService {
  constructor(
    @Inject(AppConfigService) private readonly config: AppConfigService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PayoutsService) private readonly payouts: PayoutsService
  ) {}

  async acceptWebhook(rawBody: Buffer, headers: WiseWebhookHeaders) {
    const payload = this.parsePayload(rawBody);
    const eventType = payload.event_type;
    const eventId = headers.deliveryId;
    const isTestNotification = headers.testNotification === "true";

    if (!eventType || !eventId) {
      throw new BadRequestException("X-Delivery-Id and event_type are required for Wise webhooks");
    }

    const signatureValid = isTestNotification && !headers.signature
      ? true
      : this.verifySignature(rawBody, headers.signature);

    if (!signatureValid) {
      await this.createWebhookLog(rawBody, eventId, eventType, headers, false, WebhookProcessingStatus.FAILED, "Invalid signature");
      throw new UnauthorizedException("Invalid Wise webhook signature");
    }

    const created = await this.createWebhookLog(rawBody, eventId, eventType, headers, true);
    if (!created) {
      return { received: true, duplicate: true };
    }

    if (isTestNotification) {
      await this.markWebhookProcessed(eventId, WebhookProcessingStatus.IGNORED);
      return { received: true, test: true };
    }

    void this.processAcceptedWebhook(eventId, payload).catch(async (error: unknown) => {
      try {
        await this.markWebhookFailed(eventId, error);
      } catch {
        // The webhook was already accepted; avoid a background rejection in the HTTP lifecycle.
      }
    });

    return { received: true };
  }

  private verifySignature(rawBody: Buffer, signature?: string) {
    const publicKey = this.config.wise.webhookPublicKey;
    if (!signature || !publicKey) {
      return false;
    }

    const verifier = createVerify("RSA-SHA256");
    verifier.update(rawBody);
    verifier.end();

    try {
      return verifier.verify(publicKey, Buffer.from(signature, "base64"));
    } catch {
      return false;
    }
  }

  private parsePayload(rawBody: Buffer) {
    try {
      return JSON.parse(rawBody.toString("utf8")) as WiseWebhookPayload;
    } catch {
      throw new BadRequestException("Invalid Wise webhook JSON payload");
    }
  }

  private async createWebhookLog(
    rawBody: Buffer,
    eventId: string,
    eventType: string,
    headers: WiseWebhookHeaders,
    signatureValid = true,
    processingStatus: WebhookProcessingStatus = WebhookProcessingStatus.PENDING,
    errorMessage?: string
  ) {
    try {
      await this.prisma.webhookLog.create({
        data: {
          provider: "wise",
          eventId,
          eventType,
          signatureValid,
          rawPayload: rawBody.toString("utf8"),
          processingStatus,
          providerRequestId: headers.requestId ?? eventId,
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

  private async processAcceptedWebhook(eventId: string, payload: WiseWebhookPayload) {
    const providerReference = this.extractTransferReference(payload);
    const updateData: Prisma.WebhookLogUpdateInput = {
      processingStatus: WebhookProcessingStatus.PROCESSING
    };
    if (providerReference) {
      updateData.providerReference = providerReference;
    }

    await this.prisma.webhookLog.update({
      where: { provider_eventId: { provider: "wise", eventId } },
      data: updateData
    });

    if (!this.isTransferUpdateEvent(payload.event_type)) {
      await this.markWebhookProcessed(eventId, WebhookProcessingStatus.IGNORED);
      return;
    }

    const transferReference = this.extractTransferReference(payload);
    if (!transferReference) {
      throw new BadRequestException("Wise transfer webhook missing transfer reference");
    }

    const state = this.extractTransferState(payload);
    if (isCompletedTransferState(state)) {
      await this.payouts.markWisePayoutSettled(transferReference, "completed");
      await this.markWebhookProcessed(eventId);
      return;
    }

    if (isRefundedTransferState(state)) {
      await this.payouts.markWisePayoutSettled(transferReference, "refunded", `Wise transfer ${state}`);
      await this.markWebhookProcessed(eventId);
      return;
    }

    if (isFailedTransferState(state)) {
      await this.payouts.markWisePayoutSettled(transferReference, "failed", `Wise transfer ${state}`);
      await this.markWebhookProcessed(eventId);
      return;
    }

    await this.markWebhookProcessed(eventId, WebhookProcessingStatus.IGNORED);
  }

  private isTransferUpdateEvent(eventType?: string) {
    return Boolean(eventType?.startsWith("transfers#"));
  }

  private extractTransferReference(payload: WiseWebhookPayload) {
    const data = payload.data ?? {};
    const resource = readObject(data.resource);
    const transferId = readString(data.transfer_id)
      ?? readString(data.transferId)
      ?? readString(data.id)
      ?? readString(resource?.id)
      ?? readString(resource?.resource_id);

    return transferId;
  }

  private extractTransferState(payload: WiseWebhookPayload) {
    const data = payload.data ?? {};
    const resource = readObject(data.resource);
    return (
      readString(data.current_state)
      ?? readString(data.currentState)
      ?? readString(data.status)
      ?? readString(data.state)
      ?? readString(resource?.current_state)
      ?? readString(resource?.status)
      ?? readString(resource?.state)
      ?? ""
    ).toLowerCase();
  }

  private async markWebhookProcessed(
    eventId: string,
    status: WebhookProcessingStatus = WebhookProcessingStatus.PROCESSED
  ) {
    await this.prisma.webhookLog.update({
      where: { provider_eventId: { provider: "wise", eventId } },
      data: { processingStatus: status, processedAt: new Date() }
    });
  }

  private async markWebhookFailed(eventId: string, error: unknown) {
    await this.prisma.webhookLog.update({
      where: { provider_eventId: { provider: "wise", eventId } },
      data: {
        processingStatus: WebhookProcessingStatus.FAILED,
        errorMessage: error instanceof Error ? error.message : "Wise webhook processing failed",
        processedAt: new Date()
      }
    });
  }
}

function readObject(value: unknown) {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined;
}

function readString(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number") {
    return String(value);
  }

  return undefined;
}

function isCompletedTransferState(state: string) {
  return ["outgoing_payment_sent", "funds_converted", "completed", "sent", "success"].includes(state);
}

function isFailedTransferState(state: string) {
  return ["bounced_back", "cancelled", "failed"].includes(state);
}

function isRefundedTransferState(state: string) {
  return ["funds_refunded", "refunded"].includes(state);
}
