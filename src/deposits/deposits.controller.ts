import { Body, Controller, Get, Headers, Inject, Param, Post, UseGuards } from "@nestjs/common";
import { ApiSecurity, ApiTags } from "@nestjs/swagger";
import { ApiKeyGuard } from "../auth/api-key.guard";
import { CreateXafDepositQuoteDto } from "./dto/create-xaf-deposit-quote.dto";
import { CreateXafDepositDto } from "./dto/create-xaf-deposit.dto";
import { DepositsService } from "./deposits.service";

@ApiTags("deposits")
@ApiSecurity("reepay-api-key")
@UseGuards(ApiKeyGuard)
@Controller({ path: "deposits", version: "1" })
export class DepositsController {
  constructor(@Inject(DepositsService) private readonly deposits: DepositsService) {}

  @Post("xaf/quote")
  createXafDepositQuote(@Body() body: CreateXafDepositQuoteDto) {
    return this.deposits.createXafDepositQuote(body);
  }

  @Post("xaf")
  createXafDeposit(
    @Body() body: CreateXafDepositDto,
    @Headers("x-request-id") requestId?: string,
    @Headers("idempotency-key") idempotencyKey?: string
  ) {
    return this.deposits.createXafDeposit(body, requestId, idempotencyKey);
  }

  @Get(":id")
  getDepositStatus(@Param("id") id: string, @Headers("x-request-id") requestId?: string) {
    return this.deposits.getDepositStatus(id, requestId);
  }

  @Post(":id/verify")
  verifyDeposit(@Param("id") id: string, @Headers("x-request-id") requestId?: string) {
    return this.deposits.verifyDeposit(id, requestId);
  }
}
