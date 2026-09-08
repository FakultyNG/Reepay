import { HttpService } from "@nestjs/axios";
import { Inject, Injectable } from "@nestjs/common";
import { OutboundWebhookDeliveryStatus, Prisma } from "@prisma/client";
import type { AxiosError, AxiosRequestConfig } from "axios";
import { createHmac, randomUUID } from "node:crypto";
import { lastValueFrom } from "rxjs";
import { AppConfigService } from "../../config/app-config.service";
import { PrismaService } from "../../database/prisma.service";
import type { SangaPayWebhookEventType, SangaPayWebhookPayload } from "./sangapay-webhook.types";

@Injectable()
export class SangaPayWebhookDispatcher {
  constructor(
    @Inject(HttpService) private readonly http: HttpService,
    @Inject(AppConfigService) private readonly config: AppConfigService,
    @Inject(PrismaService) private readonly prisma: PrismaService
  ) {}

  async dispatch(eventType: SangaPayWebhookEventType, data: Record<string, unknown>, requestId?: string) {
    const settings = this.config.sangapayWebhook;
    const payload: SangaPayWebhookPayload = {
      eventId: `rp_evt_${randomUUID()}`,
      eventType,
      occurredAt: new Date().toISOString(),
      data
    };

    if (!settings.enabled || !settings.url || !settings.secret) {
      await this.prisma.outboundWebhookDelivery.create({
        data: {
          eventId: payload.eventId,
          eventType,
          endpointUrl: settings.url ?? "disabled",
          payload: payload as unknown as Prisma.InputJsonValue,
          signature: "",
          status: OutboundWebhookDeliveryStatus.DISABLED
        }
      });
      return { queued: false, disabled: true, eventId: payload.eventId };
    }

    const rawPayload = JSON.stringify(payload);
    const signature = createHmac("sha256", settings.secret).update(rawPayload).digest("hex");
    const delivery = await this.prisma.outboundWebhookDelivery.create({
      data: {
        eventId: payload.eventId,
        eventType,
        endpointUrl: settings.url,
        payload: payload as unknown as Prisma.InputJsonValue,
        signature,
        status: OutboundWebhookDeliveryStatus.PENDING
      }
    });

    const maxAttempts = settings.maxAttempts ?? 1;
    const retryBaseDelayMs = settings.retryBaseDelayMs ?? 0;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await this.send(settings.url, rawPayload, {
          "Content-Type": "application/json",
          "X-Reepay-Signature": signature,
          "X-Reepay-Event": eventType,
          "X-Reepay-Event-Id": payload.eventId,
          "X-Reepay-Timestamp": payload.occurredAt,
          "X-Request-Id": requestId ?? payload.eventId
        });

        await this.prisma.outboundWebhookDelivery.update({
          where: { id: delivery.id },
          data: {
            status: OutboundWebhookDeliveryStatus.DELIVERED,
            attempts: { increment: 1 },
            lastStatusCode: response.status,
            deliveredAt: new Date()
          }
        });
        return { queued: true, delivered: true, eventId: payload.eventId };
      } catch (error) {
        const statusCode = readStatusCode(error);
        await this.prisma.outboundWebhookDelivery.update({
          where: { id: delivery.id },
          data: {
            status: OutboundWebhookDeliveryStatus.FAILED,
            attempts: { increment: 1 },
            ...(statusCode ? { lastStatusCode: statusCode } : {}),
            lastError: error instanceof Error ? error.message : "SangaPay webhook delivery failed"
          }
        });

        if (attempt >= maxAttempts || !isRetryableDeliveryError(error)) {
          return { queued: true, delivered: false, eventId: payload.eventId };
        }

        await delay(retryBaseDelayMs * 2 ** (attempt - 1));
      }
    }

    return { queued: true, delivered: false, eventId: payload.eventId };
  }

  async retryFailedDeliveries(limit: number, requestId?: string) {
    const settings = this.config.sangapayWebhook;
    if (!settings.enabled || !settings.url || !settings.secret) {
      return { checked: 0, delivered: 0, failed: 0, disabled: true };
    }

    const deliveries = await this.prisma.outboundWebhookDelivery.findMany({
      where: {
        status: OutboundWebhookDeliveryStatus.FAILED,
        attempts: { lt: settings.maxAttempts ?? 1 }
      },
      orderBy: { createdAt: "asc" },
      take: limit
    });

    let delivered = 0;
    let failed = 0;

    for (const delivery of deliveries) {
      const payload = delivery.payload as unknown as SangaPayWebhookPayload;
      const rawPayload = JSON.stringify(payload);
      const signature = createHmac("sha256", settings.secret).update(rawPayload).digest("hex");

      try {
        const response = await this.send(delivery.endpointUrl, rawPayload, {
          "Content-Type": "application/json",
          "X-Reepay-Signature": signature,
          "X-Reepay-Event": delivery.eventType,
          "X-Reepay-Event-Id": delivery.eventId,
          "X-Reepay-Timestamp": payload.occurredAt,
          "X-Request-Id": requestId ?? delivery.eventId
        });

        await this.prisma.outboundWebhookDelivery.update({
          where: { id: delivery.id },
          data: {
            signature,
            status: OutboundWebhookDeliveryStatus.DELIVERED,
            attempts: { increment: 1 },
            lastStatusCode: response.status,
            lastError: null,
            deliveredAt: new Date()
          }
        });
        delivered += 1;
      } catch (error) {
        const statusCode = readStatusCode(error);
        await this.prisma.outboundWebhookDelivery.update({
          where: { id: delivery.id },
          data: {
            signature,
            attempts: { increment: 1 },
            ...(statusCode ? { lastStatusCode: statusCode } : {}),
            lastError: error instanceof Error ? error.message : "SangaPay webhook retry failed"
          }
        });
        failed += 1;
      }
    }

    return { checked: deliveries.length, delivered, failed };
  }

  private async send(url: string, rawPayload: string, headers: Record<string, string>) {
    return lastValueFrom(
      this.http.request({
        url,
        method: "post",
        headers,
        data: rawPayload,
        transformRequest: [(body: string) => body],
        timeout: 5000
      } satisfies AxiosRequestConfig)
    );
  }
}

function readStatusCode(error: unknown) {
  if (isAxiosError(error)) {
    return error.response?.status;
  }

  return undefined;
}

function isAxiosError(error: unknown): error is AxiosError {
  return Boolean(error && typeof error === "object" && "isAxiosError" in error);
}

function isRetryableDeliveryError(error: unknown) {
  if (!isAxiosError(error)) {
    return false;
  }

  if (!error.response) {
    return true;
  }

  return error.response.status === 408 || error.response.status === 429 || error.response.status >= 500;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
