import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { AppConfigService } from "../src/config/app-config.service";
import { FeeService } from "../src/common/fees/fee.service";

function buildFeeService(overrides: NodeJS.ProcessEnv) {
  const previousEnv = process.env;
  process.env = {
    ...previousEnv,
    REEPAY_PORT: "4000",
    DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/reepay?schema=public",
    REDIS_URL: "redis://localhost:6379",
    REEPAY_API_KEY: "test-api-key",
    REEPAY_FEE_CURRENCY: "XAF",
    REEPAY_ENV: "test",
    KRYPTAPAY_BASE_URL: "https://kryptapay.example.invalid",
    KRYPTAPAY_API_KEY: "kryptapay-key",
    KRYPTAPAY_WEBHOOK_SECRET: "kryptapay-secret",
    ...overrides
  };

  return {
    service: new FeeService(new AppConfigService()),
    restore: () => {
      process.env = previousEnv;
    }
  };
}

describe("FeeService", () => {
  it("uses the fixed customer fee from environment", () => {
    const { service, restore } = buildFeeService({
      REEPAY_FEE_TYPE: "fixed",
      REEPAY_FEE_FIXED: "150",
      REEPAY_FEE_PERCENT: "2.5"
    });

    expect(service.calculateCustomerFee(10_000)).toEqual({
      transactionAmount: 10_000,
      customerFee: 150,
      currency: "XAF",
      feeType: "fixed"
    });

    restore();
  });

  it("uses the percentage customer fee from environment", () => {
    const { service, restore } = buildFeeService({
      REEPAY_FEE_TYPE: "percentage",
      REEPAY_FEE_FIXED: "150",
      REEPAY_FEE_PERCENT: "2.5"
    });

    expect(service.calculateCustomerFee(10_000)).toEqual({
      transactionAmount: 10_000,
      customerFee: 250,
      currency: "XAF",
      feeType: "percentage"
    });

    restore();
  });

  it("normalizes percentage fee type casing from environment", () => {
    const { service, restore } = buildFeeService({
      REEPAY_FEE_TYPE: " Percentage ",
      REEPAY_FEE_FIXED: "150",
      REEPAY_FEE_PERCENT: "2.5"
    });

    expect(service.calculateCustomerFee(10_000)).toEqual({
      transactionAmount: 10_000,
      customerFee: 250,
      currency: "XAF",
      feeType: "percentage"
    });

    restore();
  });

  it("caps percentage customer fees from environment", () => {
    const { service, restore } = buildFeeService({
      REEPAY_FEE_TYPE: "percentage",
      REEPAY_FEE_FIXED: "150",
      REEPAY_FEE_PERCENT: "2.5",
      REEPAY_FEE_PERCENT_CAP: "10"
    });

    expect(service.calculateCustomerFee(10_000)).toEqual({
      transactionAmount: 10_000,
      customerFee: 10,
      currency: "XAF",
      feeType: "percentage"
    });

    restore();
  });

  it("caps EUR payout percentage fees at 10 EUR by default", () => {
    const { service, restore } = buildFeeService({
      REEPAY_FEE_TYPE: "fixed",
      REEPAY_EUR_PAYOUT_FEE_FIXED: "1",
      REEPAY_EUR_PAYOUT_FEE_PERCENT: "5"
    });

    expect(service.calculateCurrencyFeeDecimal(new Prisma.Decimal("1000"), "EUR").toFixed()).toBe("11");

    restore();
  });

  it("calculates and rounds the fallback KryptaPay deposit fee to whole XAF", () => {
    const { service, restore } = buildFeeService({
      REEPAY_FEE_TYPE: "fixed",
      KRYPTAPAY_DEPOSIT_FEE_FALLBACK_ENABLED: "true",
      KRYPTAPAY_DEPOSIT_FEE_PERCENT: "2.5"
    });

    expect(service.calculateDepositProviderFeeDecimal(new Prisma.Decimal("352")).toFixed()).toBe("9");

    restore();
  });

  it("disables the KryptaPay deposit fee fallback from environment", () => {
    const { service, restore } = buildFeeService({
      REEPAY_FEE_TYPE: "fixed",
      KRYPTAPAY_DEPOSIT_FEE_FALLBACK_ENABLED: "false",
      KRYPTAPAY_DEPOSIT_FEE_PERCENT: "2.5"
    });

    expect(service.calculateDepositProviderFeeDecimal(new Prisma.Decimal("352")).toFixed()).toBe("0");

    restore();
  });

  it("prefers a provider-quoted deposit fee over the environment fallback", () => {
    const { service, restore } = buildFeeService({
      REEPAY_FEE_TYPE: "fixed",
      KRYPTAPAY_DEPOSIT_FEE_FALLBACK_ENABLED: "true",
      KRYPTAPAY_DEPOSIT_FEE_PERCENT: "2.5"
    });

    expect(
      service.calculateDepositProviderFeeDecimal(new Prisma.Decimal("352"), new Prisma.Decimal("7.1")).toFixed()
    ).toBe("8");

    restore();
  });
});
