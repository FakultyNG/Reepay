import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { timingSafeEqual } from "node:crypto";
import { AppConfigService } from "../config/app-config.service";
import { PrismaService } from "../database/prisma.service";

@Injectable()
export class AdminApiKeyGuard implements CanActivate {
  constructor(
    @Inject(AppConfigService) private readonly config: AppConfigService,
    @Inject(PrismaService) private readonly prisma: PrismaService
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    const adminKey = request.header("x-reepay-admin-api-key");
    const adminEmail = request.header("x-reepay-admin-email") ?? this.config.admin.email;

    if (!this.config.admin.apiKey) {
      throw new UnauthorizedException("Reepay admin API key is not configured");
    }

    if (!adminKey || !secureEqual(adminKey, this.config.admin.apiKey)) {
      throw new UnauthorizedException("Invalid Reepay admin API key");
    }

    const admin = await this.prisma.reepayAdminUser.findUnique({ where: { email: adminEmail } });
    if (!admin?.isActive) {
      throw new UnauthorizedException("Invalid Reepay admin user");
    }

    return true;
  }
}

function secureEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
