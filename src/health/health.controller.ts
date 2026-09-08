import { Controller, Get, Inject, VERSION_NEUTRAL } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { HealthService } from "./health.service";

@ApiTags("health")
@Controller({ version: VERSION_NEUTRAL })
export class HealthController {
  constructor(@Inject(HealthService) private readonly healthService: HealthService) {}

  @Get(["health", "api/v1/health"])
  health() {
    return this.healthService.health();
  }

  @Get(["ready", "api/v1/ready"])
  async ready() {
    return this.healthService.ready();
  }
}
