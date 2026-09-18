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

  it("treats an empty percentage cap as no cap", () => {
    const { service, restore } = buildFeeService({
      REEPAY_FEE_TYPE: "percentage",
      REEPAY_FEE_FIXED: "150",
      REEPAY_FEE_PERCENT: "2.5",
      REEPAY_FEE_PERCENT_CAP: ""
    });

    expect(service.calculateCustomerFeeDecimal(new Prisma.Decimal("10000")).toFixed()).toBe("250");

    restore();
  });

  it("treats a zero percentage cap as no cap", () => {
    const { service, restore } = buildFeeService({
      REEPAY_FEE_TYPE: "percentage",
      REEPAY_FEE_FIXED: "150",
      REEPAY_FEE_PERCENT: "2.5",
      REEPAY_FEE_PERCENT_CAP: "0"
    });

    expect(service.calculateCustomerFeeDecimal(new Prisma.Decimal("300")).toFixed()).toBe("8");

    restore();
  });

  it("rounds percentage-based XAF fees up to a whole unit", () => {
    const { service, restore } = buildFeeService({
      REEPAY_FEE_TYPE: "percentage",
      REEPAY_FEE_FIXED: "50",
      REEPAY_FEE_PERCENT: "2.5",
      REEPAY_FEE_PERCENT_CAP: ""
    });

    expect(service.calculateCustomerFeeDecimal(new Prisma.Decimal("302")).toFixed()).toBe("8");
    expect(service.calculateCustomerFee(302).customerFee).toBe(8);

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

  it("grosses up the fallback KryptaPay deposit fee to preserve the expected settlement", () => {
    const { service, restore } = buildFeeService({
      REEPAY_FEE_TYPE: "fixed",
      KRYPTAPAY_DEPOSIT_FEE_FALLBACK_ENABLED: "true",
      KRYPTAPAY_DEPOSIT_FEE_PERCENT: "2.5"
    });

    expect(service.calculateDepositProviderFeeDecimal(new Prisma.Decimal("352")).toFixed()).toBe("10");
    expect(service.calculateDepositProviderFeeDecimal(new Prisma.Decimal("6801")).toFixed()).toBe("175");

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

  it("rounds the KryptaPay bank payout fallback fee up to whole XAF", () => {
    const { service, restore } = buildFeeService({
      REEPAY_FEE_TYPE: "fixed",
      KRYPTAPAY_BANK_PAYOUT_FEE_FALLBACK_ENABLED: "true",
      KRYPTAPAY_BANK_PAYOUT_FEE_PERCENT: "0.3"
    });

    expect(service.calculateBankPayoutProviderFeeDecimal(new Prisma.Decimal("100001")).toFixed()).toBe("301");

    restore();
  });

  it("prefers a quoted bank payout fee and supports disabling the fallback", () => {
    const { service, restore } = buildFeeService({
      REEPAY_FEE_TYPE: "fixed",
      KRYPTAPAY_BANK_PAYOUT_FEE_FALLBACK_ENABLED: "false",
      KRYPTAPAY_BANK_PAYOUT_FEE_PERCENT: "0.3"
    });

    expect(service.calculateBankPayoutProviderFeeDecimal(new Prisma.Decimal("100001")).toFixed()).toBe("0");
    expect(
      service.calculateBankPayoutProviderFeeDecimal(new Prisma.Decimal("100001"), new Prisma.Decimal("275.2")).toFixed()
    ).toBe("276");

    restore();
  });
});
