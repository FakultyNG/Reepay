export type SangaPayWebhookEventType =
  | "deposit.created"
  | "deposit.completed"
  | "deposit.failed"
  | "wallet.conversion.processing"
  | "wallet.conversion.completed"
  | "wallet.conversion.failed"
  | "payout.created"
  | "payout.processing"
  | "payout.completed"
  | "payout.failed"
  | "payout.refunded";

export type SangaPayWebhookPayload = {
  eventId: string;
  eventType: SangaPayWebhookEventType;
  occurredAt: string;
  data: Record<string, unknown>;
};
