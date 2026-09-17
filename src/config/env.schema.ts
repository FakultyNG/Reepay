import { z } from "zod";

const feeTypeSchema = z.preprocess(
  (value) => (typeof value === "string" ? value.trim().toLowerCase() : value),
  z.enum(["fixed", "percentage"])
);
const reepayEnvSchema = z.preprocess(
  (value) => (typeof value === "string" ? value.toLowerCase() : value),
  z.enum(["sandbox", "production", "test", "development"])
);
const optionalSecretSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().optional()
).transform((value) => value ?? "");
const optionalWebhookSecretSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().min(1).optional()
);
const optionalPositiveIntSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.coerce.number().int().positive().optional()
);
const optionalPositiveNumberSchema = z.preprocess((value) => {
  if (typeof value === "string") {
    const normalized = value.trim();
    if (normalized === "" || Number(normalized) === 0) return undefined;
  }

  if (value === 0) return undefined;
  return value;
}, z.coerce.number().positive().optional());
const booleanSchema = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return value;
}, z.boolean());

export const envSchema = z
  .object({
    REEPAY_PORT: z.coerce.number().int().positive().default(4000),
    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url(),
    REEPAY_API_KEY: z.string().min(1),
    REEPAY_ALLOWED_APPLICATION_IDS: z.string().min(1).default("sangapay-backend"),
    REEPAY_ADMIN_EMAIL: z.string().email().default("owner@reepay.local"),
    REEPAY_ADMIN_API_KEY: optionalSecretSchema,
    SANGAPAY_WEBHOOK_ENABLED: z.coerce.boolean().default(false),
    SANGAPAY_WEBHOOK_URL: z.string().url().optional(),
    SANGAPAY_WEBHOOK_SECRET: optionalWebhookSecretSchema,
    SANGAPAY_WEBHOOK_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
    SANGAPAY_WEBHOOK_RETRY_BASE_DELAY_MS: z.coerce.number().int().nonnegative().default(500),
    REEPAY_FEE_TYPE: feeTypeSchema.default("fixed"),
    REEPAY_FEE_FIXED: z.coerce.number().nonnegative().default(0),
    REEPAY_FEE_PERCENT: z.coerce.number().nonnegative().default(0),
    REEPAY_FEE_PERCENT_CAP: optionalPositiveNumberSchema,
    REEPAY_FEE_CURRENCY: z.string().min(3).max(3).default("XAF"),
    REEPAY_ENV: reepayEnvSchema.default("sandbox"),
    KRYPTAPAY_BASE_URL: z.string().url(),
    KRYPTAPAY_API_KEY: z.string().min(1),
    KRYPTAPAY_WEBHOOK_SECRET: z.string().min(1),
    KRYPTAPAY_DEPOSIT_FEE_FALLBACK_ENABLED: booleanSchema.default(false),
    KRYPTAPAY_DEPOSIT_FEE_PERCENT: z.coerce.number().nonnegative().lt(100).default(2.5),
    KRYPTAPAY_BANK_PAYOUT_FEE_FALLBACK_ENABLED: booleanSchema.default(false),
    KRYPTAPAY_BANK_PAYOUT_FEE_PERCENT: z.coerce.number().nonnegative().lt(100).default(0.3),
    WISE_BASE_URL: z.string().url().default("https://api.wise.com"),
    WISE_API_TOKEN: optionalSecretSchema,
    WISE_PROFILE_ID: optionalPositiveIntSchema,
    WISE_EUR_BALANCE_ID: optionalPositiveIntSchema,
    WISE_WEBHOOK_PUBLIC_KEY: optionalSecretSchema,
    WISE_EUR_FUNDING_IBAN: optionalSecretSchema,
    WISE_EUR_FUNDING_ACCOUNT_NAME: optionalSecretSchema,
    WISE_EUR_FUNDING_BANK_NAME: optionalSecretSchema,
    REEPAY_EUR_PAYOUT_FEE_FIXED: z.coerce.number().nonnegative().default(0),
    REEPAY_EUR_PAYOUT_FEE_PERCENT: z.coerce.number().nonnegative().default(0),
    REEPAY_EUR_PAYOUT_FEE_PERCENT_CAP: z.coerce.number().nonnegative().default(10),
    REEPAY_USDC_PAYOUT_FEE_FIXED: z.coerce.number().nonnegative().default(0),
    REEPAY_USDC_PAYOUT_FEE_PERCENT: z.coerce.number().nonnegative().default(0),
    REEPAY_USDC_PAYOUT_FEE_PERCENT_CAP: optionalPositiveNumberSchema,
    REEPAY_RECONCILIATION_ENABLED: z.coerce.boolean().default(true),
    REEPAY_RECONCILIATION_INTERVAL_MS: z.coerce.number().int().positive().default(300_000),
    REEPAY_RECONCILIATION_LOOKBACK_MINUTES: z.coerce.number().int().positive().default(1440),
    REEPAY_RECONCILIATION_BATCH_SIZE: z.coerce.number().int().positive().max(100).default(25)
  })
  .superRefine((env, ctx) => {
    if (env.REEPAY_FEE_TYPE === "fixed" && env.REEPAY_FEE_FIXED < 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["REEPAY_FEE_FIXED"],
        message: "REEPAY_FEE_FIXED must be zero or greater when REEPAY_FEE_TYPE=fixed"
      });
    }

    if (env.REEPAY_FEE_TYPE === "percentage" && env.REEPAY_FEE_PERCENT < 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["REEPAY_FEE_PERCENT"],
        message: "REEPAY_FEE_PERCENT must be zero or greater when REEPAY_FEE_TYPE=percentage"
      });
    }

    if (env.SANGAPAY_WEBHOOK_ENABLED && !env.SANGAPAY_WEBHOOK_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["SANGAPAY_WEBHOOK_URL"],
        message: "SANGAPAY_WEBHOOK_URL is required when SANGAPAY_WEBHOOK_ENABLED=true"
      });
    }

    if (env.SANGAPAY_WEBHOOK_ENABLED && !env.SANGAPAY_WEBHOOK_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["SANGAPAY_WEBHOOK_SECRET"],
        message: "SANGAPAY_WEBHOOK_SECRET is required when SANGAPAY_WEBHOOK_ENABLED=true"
      });
    }

  });

export type Env = z.infer<typeof envSchema>;
