import { ApiProperty } from "@nestjs/swagger";
import { IsString } from "class-validator";

export class ConfirmWalletConversionDto {
  @ApiProperty()
  @IsString()
  quoteId!: string;
}
