import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/database/prisma.service";
import { REDIS_CLIENT } from "../src/redis/redis.constants";

describe("Reepay API foundation", () => {
  let app: INestApplication;

  beforeEach(async () => {
    process.env.REEPAY_PORT = "4000";
    process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/reepay?schema=public";
    process.env.REDIS_URL = "redis://localhost:6379";
    process.env.REEPAY_API_KEY = "test-api-key";
    process.env.REEPAY_FEE_TYPE = "fixed";
    process.env.REEPAY_FEE_FIXED = "100";
    process.env.REEPAY_FEE_PERCENT = "2";
    process.env.REEPAY_FEE_CURRENCY = "XAF";
    process.env.REEPAY_ENV = "test";
    process.env.KRYPTAPAY_BASE_URL = "https://kryptapay.example.invalid";
    process.env.KRYPTAPAY_API_KEY = "kryptapay-key";
    process.env.KRYPTAPAY_WEBHOOK_SECRET = "kryptapay-secret";

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    })
      .overrideProvider(PrismaService)
      .useValue({
        $connect: vi.fn(),
        $disconnect: vi.fn(),
        $queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }])
      })
      .overrideProvider(REDIS_CLIENT)
      .useValue({
        ping: vi.fn().mockResolvedValue("PONG")
      })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app?.close();
    vi.restoreAllMocks();
  });

  it("exposes a public health check", async () => {
    const response = await request(app.getHttpServer()).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      service: "reepay",
      status: "ok"
    });
    expect(response.headers["x-request-id"]).toBeDefined();
  });

  it("exposes a prefixed health check for host probes configured with /api/v1/health", async () => {
    const response = await request(app.getHttpServer()).get("/api/v1/health");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      service: "reepay",
      status: "ok"
    });
  });

  it("exposes readiness with database and redis checks", async () => {
    const response = await request(app.getHttpServer()).get("/ready");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      service: "reepay",
      status: "ok",
      dependencies: {
        database: "ok",
        redis: "ok"
      }
    });
  });

  it("exposes prefixed readiness for /api/v1/ready probes", async () => {
    const response = await request(app.getHttpServer()).get("/api/v1/ready");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      service: "reepay",
      status: "ok",
      dependencies: {
        database: "ok",
        redis: "ok"
      }
    });
  });
});
