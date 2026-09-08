import { ApiProperty } from "@nestjs/swagger";
import { IsString, Matches, MaxLength } from "class-validator";

export class CreateEurWiseTagPayoutQuoteDto {
  @ApiProperty()
  @IsString()
  @MaxLength(120)
  customerId!: string;

  @ApiProperty({ example: "250.00", description: "Amount to send from the EUR wallet." })
  @Matches(/^\d+(\.\d{1,8})?$/)
  amount!: string;

  @ApiProperty({ example: "@recipient" })
  @IsString()
  @MaxLength(120)
  wiseTag!: string;
}
