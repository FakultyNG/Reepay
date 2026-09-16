import { Controller, Get, Inject, Query, UseGuards } from "@nestjs/common";
import { ApiSecurity, ApiTags } from "@nestjs/swagger";
import { AdminApiKeyGuard } from "./admin-api-key.guard";
import { AdminService } from "./admin.service";
import { FeeEarningsQueryDto } from "./dto/fee-earnings-query.dto";

@ApiTags("admin")
@ApiSecurity("reepay-admin-api-key")
@UseGuards(AdminApiKeyGuard)
@Controller({ path: "admin", version: "1" })
export class AdminController {
  constructor(@Inject(AdminService) private readonly admin: AdminService) {}

  @Get("fees/earnings")
  getFeeEarnings(@Query() query: FeeEarningsQueryDto) {
    return this.admin.getFeeEarnings(query);
  }
}
