import { ApiProperty } from "@nestjs/swagger";
import { IsString, Matches, MaxLength } from "class-validator";

export class CreateWalletConversionQuoteDto {
  @ApiProperty()
  @IsString()
  @MaxLength(120)
  customerId!: string;

  @ApiProperty({ description: "Destination amount to credit to the target wallet." })
  @Matches(/^\d+(\.\d{1,8})?$/)
  amount!: string;
}
