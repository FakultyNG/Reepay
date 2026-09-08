import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, Matches, MaxLength } from "class-validator";

export class CreateEurPayoutQuoteDto {
  @ApiProperty()
  @IsString()
  @MaxLength(120)
  customerId!: string;

  @ApiProperty({ example: "250.00", description: "Recipient amount in EUR" })
  @Matches(/^\d+(\.\d{1,8})?$/)
  amount!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(34)
  iban!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(180)
  beneficiaryName!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  bankName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(240)
  beneficiaryAddress?: string;
}
