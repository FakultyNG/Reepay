import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

const decimalPattern = /^\d+(\.\d{1,8})?$/;

export function parseMoneyDecimal(value: string): Prisma.Decimal {
  if (!decimalPattern.test(value)) {
    throw new BadRequestException("Amount must be a decimal string with up to 8 fractional digits");
  }

  return new Prisma.Decimal(value);
}

export function decimalToString(value: Prisma.Decimal | string | number) {
  return new Prisma.Decimal(value).toFixed();
}
