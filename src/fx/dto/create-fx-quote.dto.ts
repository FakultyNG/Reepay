import { IsEnum, IsOptional, Matches } from "class-validator";

export enum FxQuoteTargetCurrency {
  EUR = "EUR",
  USDC = "USDC"
}

export enum FxQuotePurpose {
  DISPLAY = "display",
  PAYOUT = "payout"
}

export class CreateFxQuoteDto {
  @Matches(/^\d+(\.\d{1,8})?$/)
  amount!: string;

  @IsEnum(FxQuoteTargetCurrency)
  to!: FxQuoteTargetCurrency;

  @IsOptional()
  @IsEnum(FxQuotePurpose)
  purpose?: FxQuotePurpose;
}

export class CreateXafAmountQuoteDto {
  @Matches(/^\d+(\.\d{1,8})?$/)
  amount!: string;
}
