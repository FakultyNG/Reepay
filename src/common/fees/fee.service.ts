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
    const customerFee = fee.type === "fixed" ? fee.fixed : cappedPercentageFee;

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
    ).toDecimalPlaces(4);
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
