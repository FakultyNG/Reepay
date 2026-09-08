import type { HttpService } from "@nestjs/axios";
import { OutboundWebhookDeliveryStatus } from "@prisma/client";
import { createHmac } from "node:crypto";
import { of } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import type { AppConfigService } from "../src/config/app-config.service";
import type { PrismaService } from "../src/database/prisma.service";
import { SangaPayWebhookDispatcher } from "../src/webhooks/sangapay";

describe("SangaPayWebhookDispatcher", () => {
  it("sends a signed provider-neutral webhook and records successful delivery", async () => {
    const request = vi.fn().mockReturnValue(of({ status: 204 }));
    const update = vi.fn();
    const prisma = {
      outboundWebhookDelivery: {
        create: vi.fn().mockResolvedValue({ id: "delivery_123" }),
        update
      }
    } as unknown as PrismaService;
    const config = {
      sangapayWebhook: {
        enabled: true,
        url: "https://sangapay.example.com/webhooks/reepay",
        secret: "sanga_webhook_secret"
      }
    } as AppConfigService;
    const service = new SangaPayWebhookDispatcher({ request } as unknown as HttpService, config, prisma);

    const result = await service.dispatch(
      "deposit.completed",
      {
        customerId: "sanga_user_1",
        depositId: "dep_123",
        amount: "10000",
        currency: "XAF",
        status: "completed"
      },
      "req_123"
    );

    expect(result).toMatchObject({ queued: true, delivered: true });
    expect(request).toHaveBeenCalledTimes(1);
    const httpCall = request.mock.calls[0][0];
    const expectedSignature = createHmac("sha256", "sanga_webhook_secret").update(httpCall.data).digest("hex");

    expect(JSON.parse(httpCall.data)).toMatchObject({
      eventType: "deposit.completed",
      data: {
        customerId: "sanga_user_1",
        depositId: "dep_123",
        amount: "10000",
        currency: "XAF",
        status: "completed"
      }
    });
    expect(httpCall.headers).toMatchObject({
      "Content-Type": "application/json",
      "X-Reepay-Signature": expectedSignature,
      "X-Reepay-Event": "deposit.completed",
      "X-Request-Id": "req_123"
    });
    expect(httpCall.headers["X-Reepay-Event-Id"]).toMatch(/^rp_evt_/);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "delivery_123" },
        data: expect.objectContaining({
          status: OutboundWebhookDeliveryStatus.DELIVERED,
          attempts: { increment: 1 },
          lastStatusCode: 204,
          deliveredAt: expect.any(Date)
        })
      })
    );
  });

  it("records disabled deliveries without calling SangaPay", async () => {
    const request = vi.fn();
    const create = vi.fn().mockResolvedValue({ id: "delivery_123" });
    const prisma = {
      outboundWebhookDelivery: {
        create
      }
    } as unknown as PrismaService;
    const config = {
      sangapayWebhook: {
        enabled: false,
        url: undefined,
        secret: undefined
      }
    } as AppConfigService;
    const service = new SangaPayWebhookDispatcher({ request } as unknown as HttpService, config, prisma);

    await expect(service.dispatch("payout.failed", { payoutId: "payout_123" })).resolves.toMatchObject({
      queued: false,
      disabled: true
    });
    expect(request).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: "payout.failed",
          endpointUrl: "disabled",
          signature: "",
          status: OutboundWebhookDeliveryStatus.DISABLED
        })
      })
    );
  });
});
