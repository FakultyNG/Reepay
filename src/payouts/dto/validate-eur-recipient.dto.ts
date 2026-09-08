import { IsString, MaxLength } from "class-validator";

export class ValidateEurRecipientDto {
  @IsString()
  @MaxLength(34)
  iban!: string;

  @IsString()
  @MaxLength(180)
  beneficiaryName!: string;
}
