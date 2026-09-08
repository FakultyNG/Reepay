import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { timingSafeEqual } from "node:crypto";
import { AppConfigService } from "../config/app-config.service";

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(@Inject(AppConfigService) private readonly config: AppConfigService) {}

  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    const apiKey = request.header("x-reepay-api-key");
    const applicationId = request.header("x-reepay-application-id");

    if (!apiKey || !secureEqual(apiKey, this.config.apiKey)) {
      throw new UnauthorizedException("Invalid Reepay API key");
    }

    if (!applicationId || !this.config.allowedApplicationIds.includes(applicationId)) {
      throw new UnauthorizedException("Invalid Reepay application identity");
    }

    return true;
  }
}

function secureEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
