export type ProviderName = "kryptapay" | "wise";

export type ProviderHealth = {
  provider: ProviderName;
  configured: boolean;
};

export type MoneyCurrency = "XOF" | "XAF" | "NGN" | "GHS" | "CDF" | "EUR" | "USD" | "USDC" | "USDT";

export type PaymentNetwork =
  | "MTN_BJ"
  | "MTN_CI"
  | "MTN_CM"
  | "ORANGE_CI"
  | "ORANGE_SN"
  | "ORANGE_ML"
  | "ORANGE_BF"
  | "ORANGE_CM"
  | "MOOV_BJ"
  | "MOOV_TG"
  | "MOOV_CI"
  | "MOOV_BF"
  | "WAVE_CI"
  | "WAVE_SN"
  | "FREE_SN"
  | "TMONEY_TG"
  | "MOBICASH_ML"
  | "MOBICASH_BF"
  | "DJAMO_CI"
  | "MIXX_SN"
  | "MTN_CG"
  | "AIRTEL_CG"
  | "ORANGE_CD"
  | "AIRTEL_CD"
  | "VODACOM_CD"
  | "AFRICELL_CD"
  | "AIRTEL_GA"
  | "MOMO_NG"
  | "AIRTEL_NG"
  | "MTN_GH"
  | "VODAFONE_GH"
  | "AIRTELTIGO_GH"
  | "BANK_XOF"
  | "BANK_XAF"
  | "BANK_NGN"
  | "BANK_GHS"
  | "BANK_CDF"
  | "BANK_EUR"
  | "BANK_USD"
  | "ETH"
  | "POLYGON"
  | "TRON";

export type ProviderTransactionStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled"
  | "refunded"
  | "unknown";

export type ProviderOperationContext = {
  requestId?: string | undefined;
  idempotencyKey?: string | undefined;
  merchantReference?: string | undefined;
};

export type ProviderTrace = {
  provider: ProviderName;
  providerRequestId?: string | undefined;
  providerTransactionId?: string | undefined;
  providerReference?: string | undefined;
  merchantReference: string;
};
