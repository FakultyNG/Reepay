import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KryptaPayWebhookController } from "../src/webhooks/kryptapay/kryptapay-webhook.controller";
import { KryptaPayWebhookService } from "../src/webhooks/kryptapay/kryptapay-webhook.service";

describe("KryptaPay webhook route", () => {
  let app: INestApplication;
  const acceptWebhook = vi.fn().mockResolvedValue({ received: true });

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [KryptaPayWebhookController],
      providers: [{ provide: KryptaPayWebhookService, useValue: { acceptWebhook } }]
    }).compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    vi.clearAllMocks();
  });

  it("accepts provider webhooks only on POST /api/v1/webhooks/kryptapay", async () => {
    const rawPayload = JSON.stringify({
      event_id: "evt_route_123",
      event_type: "PAYIN_CREATED",
      created_at: "2026-08-27T00:00:00.000Z",
      data: {
        transaction_id: "tx_123",
        reference: "tx_123",
        status: "PENDING"
      }
    });

    const response = await request(app.getHttpServer())
      .post("/api/v1/webhooks/kryptapay")
      .set("Content-Type", "application/json")
      .set("X-KryptaPay-Signature", "sig_123")
      .set("X-KryptaPay-Event", "PAYIN_CREATED")
      .set("X-KryptaPay-Event-Id", "evt_route_123")
      .send(rawPayload);

    expect(response.status).toBe(202);
    expect(acceptWebhook).toHaveBeenCalledWith(expect.any(Buffer), {
      signature: "sig_123",
      eventType: "PAYIN_CREATED",
      eventId: "evt_route_123",
      requestId: undefined
    });
  });
});
