import { ApiPropertyOptional } from "@nestjs/swagger";
import { ReepayFeeSourceType, WalletCurrency } from "@prisma/client";
import { Type } from "class-transformer";
import { IsEnum, IsInt, IsISO8601, IsOptional, IsString, Max, Min } from "class-validator";

export class FeeEarningsQueryDto {
  @ApiPropertyOptional({ enum: WalletCurrency })
  @IsOptional()
  @IsEnum(WalletCurrency)
  currency?: WalletCurrency;

  @ApiPropertyOptional({ enum: ReepayFeeSourceType })
  @IsOptional()
  @IsEnum(ReepayFeeSourceType)
  sourceType?: ReepayFeeSourceType;

  @ApiPropertyOptional({ example: "2026-09-01T00:00:00.000Z" })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ example: "2026-09-30T23:59:59.999Z" })
  @IsOptional()
  @IsISO8601()
  to?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cursor?: string;
}
