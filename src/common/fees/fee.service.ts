import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AppConfigService } from "../../config/app-config.service";

export type FeeCalculation = {
  transactionAmount: number;
  customerFee: number;
  currency: string;
  feeType: "fixed" | "percentage";
};

@Injectable()
export class FeeService {
  constructor(private readonly config: AppConfigService) {}

  calculateCustomerFee(transactionAmount: number): FeeCalculation {
    if (!Number.isFinite(transactionAmount) || transactionAmount < 0) {
      throw new Error("transactionAmount must be a non-negative number");
    }

    const fee = this.config.fee;
    const percentageFee = (transactionAmount * fee.percent) / 100;
    const cappedPercentageFee =
      fee.percentCap === undefined ? percentageFee : Math.min(percentageFee, fee.percentCap);
    const customerFee = fee.type === "fixed" ? fee.fixed : Math.ceil(cappedPercentageFee);

    return {
      transactionAmount,
      customerFee: roundMoney(customerFee),
      currency: fee.currency,
      feeType: fee.type
    };
  }

  calculateCustomerFeeDecimal(transactionAmount: Prisma.Decimal): Prisma.Decimal {
    if (transactionAmount.isNegative()) {
      throw new Error("transactionAmount must be a non-negative decimal");
    }

    const fee = this.config.fee;

    if (fee.type === "fixed") {
      return new Prisma.Decimal(fee.fixed);
    }

    return capDecimal(
      transactionAmount.mul(new Prisma.Decimal(fee.percent)).div(100),
      fee.percentCap
    ).ceil();
  }

  calculateDepositProviderFeeDecimal(
    netSettlementRequired: Prisma.Decimal,
    providerQuotedFee?: Prisma.Decimal
  ): Prisma.Decimal {
    if (netSettlementRequired.isNegative()) {
      throw new Error("netSettlementRequired must be a non-negative decimal");
    }

    if (providerQuotedFee !== undefined) {
      if (providerQuotedFee.isNegative()) {
        throw new Error("providerQuotedFee must be a non-negative decimal");
      }

      return providerQuotedFee.ceil();
    }

    const fallback = this.config.kryptapay;
    if (!fallback.depositFeeFallbackEnabled || fallback.depositFeePercent === 0) {
      return new Prisma.Decimal(0);
    }

    const rate = new Prisma.Decimal(fallback.depositFeePercent).div(100);
    const grossAmount = netSettlementRequired.div(new Prisma.Decimal(1).sub(rate)).ceil();
    return grossAmount.sub(netSettlementRequired);
  }

  calculateBankPayoutProviderFeeDecimal(
    submittedXafAmount: Prisma.Decimal,
    providerQuotedFee?: Prisma.Decimal
  ): Prisma.Decimal {
    if (submittedXafAmount.isNegative()) {
      throw new Error("submittedXafAmount must be a non-negative decimal");
    }

    if (providerQuotedFee !== undefined) {
      if (providerQuotedFee.isNegative()) {
        throw new Error("providerQuotedFee must be a non-negative decimal");
      }

      return providerQuotedFee.ceil();
    }

    const fallback = this.config.kryptapay;
    if (!fallback.bankPayoutFeeFallbackEnabled || fallback.bankPayoutFeePercent === 0) {
      return new Prisma.Decimal(0);
    }

    return submittedXafAmount.mul(new Prisma.Decimal(fallback.bankPayoutFeePercent)).div(100).ceil();
  }

  calculateCurrencyFeeDecimal(
    transactionAmount: Prisma.Decimal,
    currency: "EUR" | "USDC"
  ): Prisma.Decimal {
    if (transactionAmount.isNegative()) {
      throw new Error("transactionAmount must be a non-negative decimal");
    }

    const fee = this.config.payoutFees[currency];
    const fixed = new Prisma.Decimal(fee.fixed);
    const percentage = capDecimal(
      transactionAmount.mul(new Prisma.Decimal(fee.percent)).div(100),
      fee.percentCap
    );

    return fixed.add(percentage).toDecimalPlaces(currency === "USDC" ? 8 : 4);
  }
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function capDecimal(value: Prisma.Decimal, cap?: number) {
  if (cap === undefined) {
    return value;
  }

  const capDecimalValue = new Prisma.Decimal(cap);
  return value.greaterThan(capDecimalValue) ? capDecimalValue : value;
}
