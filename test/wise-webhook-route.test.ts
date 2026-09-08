import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WiseWebhookController } from "../src/webhooks/wise/wise-webhook.controller";
import { WiseWebhookService } from "../src/webhooks/wise/wise-webhook.service";

describe("Wise webhook route", () => {
  let app: INestApplication;
  const acceptWebhook = vi.fn().mockResolvedValue({ received: true });

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [WiseWebhookController],
      providers: [{ provide: WiseWebhookService, useValue: { acceptWebhook } }]
    }).compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    vi.clearAllMocks();
  });

  it("accepts provider webhooks only on POST /api/v1/webhooks/wise", async () => {
    const rawPayload = JSON.stringify({
      data: {
        resource: {
          id: 12345
        },
        current_state: "outgoing_payment_sent"
      },
      subscription_id: "sub_123",
      event_type: "transfers#state-change",
      schema_version: "2.0.0",
      sent_at: "2026-09-08T00:00:00.000Z"
    });

    const response = await request(app.getHttpServer())
      .post("/api/v1/webhooks/wise")
      .set("Content-Type", "application/json")
      .set("X-Signature-SHA256", "signature_123")
      .set("X-Delivery-Id", "delivery_123")
      .send(rawPayload);

    expect(response.status).toBe(202);
    expect(acceptWebhook).toHaveBeenCalledWith(expect.any(Buffer), {
      signature: "signature_123",
      deliveryId: "delivery_123",
      testNotification: undefined,
      requestId: undefined
    });
  });
});
