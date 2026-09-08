import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/database/prisma.service";
import { REDIS_CLIENT } from "../src/redis/redis.constants";

describe("Payment-only Reepay surface", () => {
  let app: INestApplication;

  beforeEach(async () => {
    process.env.REEPAY_PORT = "4000";
    process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/reepay?schema=public";
    process.env.REDIS_URL = "redis://localhost:6379";
    process.env.REEPAY_API_KEY = "test-api-key";
    process.env.REEPAY_ALLOWED_APPLICATION_IDS = "sangapay-backend";
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

  it("does not expose the old auth register route", async () => {
    const response = await request(app.getHttpServer()).post("/auth/register").send({});

    expect(response.status).toBe(404);
  });

  it("does not expose the old OTP route", async () => {
    const response = await request(app.getHttpServer()).post("/auth/otp/send").send({});

    expect(response.status).toBe(404);
  });
});
