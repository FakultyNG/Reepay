import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsEmail, IsInt, IsOptional, IsString, IsUrl, Matches, Max, MaxLength, Min } from "class-validator";
import type { PaymentNetwork } from "../../providers/types";

export class CreateXafDepositDto {
  @ApiProperty()
  @IsString()
  @MaxLength(120)
  customerId!: string;

  @ApiProperty({ example: "10000" })
  @Matches(/^\d+(\.\d{1,8})?$/)
  amount!: string;

  @ApiProperty({ example: "MTN_CM" })
  @IsString()
  network!: PaymentNetwork;

  @ApiProperty({ example: "237670000000" })
  @IsString()
  @MaxLength(20)
  phoneNumber!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(180)
  fullName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  redirectUrl?: string;

  @ApiPropertyOptional({ minimum: 60, maximum: 86400 })
  @IsOptional()
  @IsInt()
  @Min(60)
  @Max(86400)
  expiresInSec?: number;
}
