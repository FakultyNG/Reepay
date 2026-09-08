import { describe, expect, it } from "vitest";
import { AppConfigService } from "../src/config/app-config.service";

function withEnv<T>(overrides: NodeJS.ProcessEnv, callback: () => T) {
  const previousEnv = process.env;
  process.env = {
    ...previousEnv,
    REEPAY_PORT: "4000",
    DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/reepay?schema=public",
    REDIS_URL: "redis://localhost:6379",
    REEPAY_API_KEY: "test-api-key",
    REEPAY_FEE_TYPE: "fixed",
    REEPAY_FEE_FIXED: "0",
    REEPAY_FEE_PERCENT: "0",
    REEPAY_FEE_CURRENCY: "XAF",
    KRYPTAPAY_BASE_URL: "https://kryptapay.example.invalid",
    KRYPTAPAY_API_KEY: "kryptapay-key",
    KRYPTAPAY_WEBHOOK_SECRET: "kryptapay-secret",
    ...overrides
  };

  try {
    return callback();
  } finally {
    process.env = previousEnv;
  }
}

describe("AppConfigService", () => {
  it("normalizes REEPAY_ENV casing from deployment environment values", () => {
    withEnv({ REEPAY_ENV: "Production" }, () => {
      expect(new AppConfigService().environment).toBe("production");
    });
  });
});
