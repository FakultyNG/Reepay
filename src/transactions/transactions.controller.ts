import { Controller, Get, Inject, Param, ParseIntPipe, Query, UseGuards } from "@nestjs/common";
import { ApiSecurity, ApiTags } from "@nestjs/swagger";
import { ApiKeyGuard } from "../auth/api-key.guard";
import { TransactionsService } from "./transactions.service";

@ApiTags("transactions")
@ApiSecurity("reepay-api-key")
@UseGuards(ApiKeyGuard)
@Controller({ path: "transactions", version: "1" })
export class TransactionsController {
  constructor(@Inject(TransactionsService) private readonly transactions: TransactionsService) {}

  @Get()
  listTransactions(
    @Query("customerId") customerId: string,
    @Query("limit", new ParseIntPipe({ optional: true })) limit?: number,
    @Query("cursor") cursor?: string
  ) {
    return this.transactions.listTransactions(customerId, limit, cursor);
  }

  @Get(":id")
  getTransaction(@Param("id") id: string) {
    return this.transactions.getTransaction(id);
  }
}
