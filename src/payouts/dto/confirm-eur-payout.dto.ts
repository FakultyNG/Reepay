import { ApiProperty } from "@nestjs/swagger";
import { IsString } from "class-validator";

export class ConfirmEurPayoutDto {
  @ApiProperty()
  @IsString()
  quoteId!: string;
}
