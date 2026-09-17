import { Injectable } from "@nestjs/common";
import { envSchema, type Env } from "./env.schema";

@Injectable()
export class AppConfigService {
  private readonly env: Env;

  constructor() {
    this.env = envSchema.parse(process.env);
  }

  get port() {
    return this.env.REEPAY_PORT;
  }

  get databaseUrl() {
    return this.env.DATABASE_URL;
  }

  get redisUrl() {
    return this.env.REDIS_URL;
  }

  get apiKey() {
    return this.env.REEPAY_API_KEY;
  }

  get allowedApplicationIds() {
    return this.env.REEPAY_ALLOWED_APPLICATION_IDS.split(",").map((id) => id.trim()).filter(Boolean);
  }

  get admin() {
    return {
      email: this.env.REEPAY_ADMIN_EMAIL,
      apiKey: this.env.REEPAY_ADMIN_API_KEY
    };
  }

  get sangapayWebhook() {
    return {
      enabled: this.env.SANGAPAY_WEBHOOK_ENABLED,
      url: this.env.SANGAPAY_WEBHOOK_URL,
      secret: this.env.SANGAPAY_WEBHOOK_SECRET,
      maxAttempts: this.env.SANGAPAY_WEBHOOK_MAX_ATTEMPTS,
      retryBaseDelayMs: this.env.SANGAPAY_WEBHOOK_RETRY_BASE_DELAY_MS
    };
  }

  get fee() {
    return {
      type: this.env.REEPAY_FEE_TYPE,
      fixed: this.env.REEPAY_FEE_FIXED,
      percent: this.env.REEPAY_FEE_PERCENT,
      percentCap: this.env.REEPAY_FEE_PERCENT_CAP,
      currency: this.env.REEPAY_FEE_CURRENCY
    };
  }

  get environment() {
    return this.env.REEPAY_ENV;
  }

  get kryptapay() {
    return {
      baseUrl: this.env.KRYPTAPAY_BASE_URL,
      apiKey: this.env.KRYPTAPAY_API_KEY,
      webhookSecret: this.env.KRYPTAPAY_WEBHOOK_SECRET,
      depositFeeFallbackEnabled: this.env.KRYPTAPAY_DEPOSIT_FEE_FALLBACK_ENABLED,
      depositFeePercent: this.env.KRYPTAPAY_DEPOSIT_FEE_PERCENT,
      bankPayoutFeeFallbackEnabled: this.env.KRYPTAPAY_BANK_PAYOUT_FEE_FALLBACK_ENABLED,
      bankPayoutFeePercent: this.env.KRYPTAPAY_BANK_PAYOUT_FEE_PERCENT
    };
  }

  get wise() {
    return {
      baseUrl: this.env.WISE_BASE_URL,
      apiToken: this.env.WISE_API_TOKEN,
      profileId: this.env.WISE_PROFILE_ID,
      eurBalanceId: this.env.WISE_EUR_BALANCE_ID,
      webhookPublicKey: this.env.WISE_WEBHOOK_PUBLIC_KEY.replace(/\\n/g, "\n"),
      eurFundingIban: this.env.WISE_EUR_FUNDING_IBAN,
      eurFundingAccountName: this.env.WISE_EUR_FUNDING_ACCOUNT_NAME,
      eurFundingBankName: this.env.WISE_EUR_FUNDING_BANK_NAME
    };
  }

  get payoutFees() {
    return {
      EUR: {
        fixed: this.env.REEPAY_EUR_PAYOUT_FEE_FIXED,
        percent: this.env.REEPAY_EUR_PAYOUT_FEE_PERCENT,
        percentCap: this.env.REEPAY_EUR_PAYOUT_FEE_PERCENT_CAP
      },
      USDC: {
        fixed: this.env.REEPAY_USDC_PAYOUT_FEE_FIXED,
        percent: this.env.REEPAY_USDC_PAYOUT_FEE_PERCENT,
        percentCap: this.env.REEPAY_USDC_PAYOUT_FEE_PERCENT_CAP
      }
    };
  }

  get reconciliation() {
    return {
      enabled: this.env.REEPAY_RECONCILIATION_ENABLED,
      intervalMs: this.env.REEPAY_RECONCILIATION_INTERVAL_MS,
      lookbackMinutes: this.env.REEPAY_RECONCILIATION_LOOKBACK_MINUTES,
      batchSize: this.env.REEPAY_RECONCILIATION_BATCH_SIZE
    };
  }
}
