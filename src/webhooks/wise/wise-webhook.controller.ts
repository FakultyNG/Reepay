import { Controller, Headers, HttpCode, Inject, Post, Req, VERSION_NEUTRAL } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { WiseWebhookService } from "./wise-webhook.service";

type RawBodyRequest = Request & {
  rawBody?: Buffer;
};

@ApiTags("webhooks")
@Controller({ path: "api/v1/webhooks/wise", version: VERSION_NEUTRAL })
export class WiseWebhookController {
  constructor(@Inject(WiseWebhookService) private readonly webhooks: WiseWebhookService) {}

  @Post(["", "transfers", "account-deposits", "transfer-issues"])
  @HttpCode(202)
  handleWebhook(
    @Req() req: RawBodyRequest,
    @Headers("x-signature-sha256") signature?: string,
    @Headers("x-delivery-id") deliveryId?: string,
    @Headers("x-test-notification") testNotification?: string,
    @Headers("x-request-id") requestId?: string
  ) {
    if (!req.rawBody) {
      throw new Error("Raw request body is required for webhook signature verification");
    }

    return this.webhooks.acceptWebhook(req.rawBody, {
      signature,
      deliveryId,
      testNotification,
      requestId
    });
  }
}
