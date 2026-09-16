import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, MaxLength, Matches } from "class-validator";
import type { PaymentNetwork } from "../../providers/types";

export class CreateXafDepositQuoteDto {
  @ApiProperty({ example: "10000" })
  @Matches(/^\d+(\.\d{1,8})?$/)
  amount!: string;

  @ApiPropertyOptional({ example: "MTN_CM" })
  @IsOptional()
  @IsString()
  network?: PaymentNetwork;

  @ApiPropertyOptional({ example: "237670000000" })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phoneNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  customerId?: string;
}
