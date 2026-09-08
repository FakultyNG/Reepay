import type { MoneyCurrency, PaymentNetwork } from "../../providers/types";

export type KryptaPayWebhookEventType =
  | "PAYIN_CREATED"
  | "PAYIN_RECEIVED"
  | "PAYIN_FAILED"
  | "PAYOUT_CREATED"
  | "PAYOUT_COMPLETED"
  | "PAYOUT_FAILED"
  | "PAYOUT_REFUNDED"
  | "PAYOUT_CANCELLED"
  | "CONVERSION_COMPLETED";

export type KryptaPayWebhookPayload = {
  event_id: string;
  event_type: KryptaPayWebhookEventType;
  created_at: string;
  data: {
    transaction_id: string;
    reference: string;
    amount?: string;
    currency?: MoneyCurrency;
    network?: PaymentNetwork;
    status: string;
    provider_ref?: string;
    failure_reason?: string;
    from_currency?: MoneyCurrency;
    to_currency?: MoneyCurrency;
    from_amount?: string;
    to_amount?: string;
  };
};
