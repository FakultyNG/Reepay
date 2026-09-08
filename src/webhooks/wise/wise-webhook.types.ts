export type WiseWebhookHeaders = {
  signature?: string | undefined;
  deliveryId?: string | undefined;
  testNotification?: string | undefined;
  requestId?: string | undefined;
};

export type WiseWebhookPayload = {
  data?: Record<string, unknown>;
  subscription_id?: string;
  event_type?: string;
  schema_version?: string;
  sent_at?: string;
};
