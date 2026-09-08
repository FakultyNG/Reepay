import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { REDIS_CLIENT } from "../redis/redis.constants";
import type Redis from "ioredis";

@Injectable()
export class HealthService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis
  ) {}

  health() {
    return {
      service: "reepay",
      status: "ok"
    };
  }

  async ready() {
    const checks = await Promise.allSettled([this.prisma.$queryRaw`SELECT 1`, this.redis.ping()]);
    const databaseOk = checks[0]?.status === "fulfilled";
    const redisOk = checks[1]?.status === "fulfilled";

    return {
      service: "reepay",
      status: databaseOk && redisOk ? "ok" : "degraded",
      dependencies: {
        database: databaseOk ? "ok" : "unavailable",
        redis: redisOk ? "ok" : "unavailable"
      }
    };
  }
}
