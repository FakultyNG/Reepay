import { ApiProperty } from "@nestjs/swagger";
import { IsString, Matches, MaxLength } from "class-validator";
import type { PaymentNetwork } from "../../providers/types";

export class CreateUsdcAddressPayoutQuoteDto {
  @ApiProperty()
  @IsString()
  @MaxLength(120)
  customerId!: string;

  @ApiProperty({ example: "100.00", description: "Amount to send from the USDC wallet." })
  @Matches(/^\d+(\.\d{1,8})?$/)
  amount!: string;

  @ApiProperty({ example: "POLYGON" })
  @IsString()
  network!: PaymentNetwork;

  @ApiProperty()
  @IsString()
  @MaxLength(180)
  address!: string;
}
