import { Controller, Headers, HttpCode, Inject, Post, Req, VERSION_NEUTRAL } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { KryptaPayWebhookService } from "./kryptapay-webhook.service";

type RawBodyRequest = Request & {
  rawBody?: Buffer;
};

@ApiTags("webhooks")
@Controller({ path: "api/v1/webhooks/kryptapay", version: VERSION_NEUTRAL })
export class KryptaPayWebhookController {
  constructor(@Inject(KryptaPayWebhookService) private readonly webhooks: KryptaPayWebhookService) {}

  @Post()
  @HttpCode(202)
  handleWebhook(
    @Req() req: RawBodyRequest,
    @Headers("x-kryptapay-signature") signature?: string,
    @Headers("x-kryptapay-event") eventType?: string,
    @Headers("x-kryptapay-event-id") eventId?: string,
    @Headers("x-request-id") requestId?: string
  ) {
    if (!req.rawBody) {
      throw new Error("Raw request body is required for webhook signature verification");
    }

    return this.webhooks.acceptWebhook(req.rawBody, {
      signature,
      eventType,
      eventId,
      requestId
    });
  }
}
