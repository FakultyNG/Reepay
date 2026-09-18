import { ApiProperty } from "@nestjs/swagger";
import { IsIn, IsString, Matches, MaxLength, MinLength } from "class-validator";
import type { PaymentNetwork } from "../../providers/types";

export const USDC_PAYOUT_NETWORKS = ["ETH", "POLYGON", "TRON"] as const satisfies readonly PaymentNetwork[];

export class CreateUsdcAddressPayoutQuoteDto {
  @ApiProperty()
  @IsString()
  @MaxLength(120)
  customerId!: string;

  @ApiProperty({ example: "100.00", description: "Amount to send from the USDC wallet." })
  @Matches(/^\d+(\.\d{1,8})?$/)
  amount!: string;

  @ApiProperty({ example: "POLYGON", enum: USDC_PAYOUT_NETWORKS })
  @IsString()
  @IsIn(USDC_PAYOUT_NETWORKS)
  network!: (typeof USDC_PAYOUT_NETWORKS)[number];

  @ApiProperty({ minLength: 20, maxLength: 80 })
  @IsString()
  @MinLength(20)
  @MaxLength(80)
  address!: string;
}
