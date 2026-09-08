import { VersioningType } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiKeyGuard } from "../src/auth";
import { WalletsController } from "../src/wallets/wallets.controller";
import { WalletsService } from "../src/wallets/wallets.service";
import type { INestApplication } from "@nestjs/common";

describe("Wallet routes", () => {
  let app: INestApplication;
  const wallets = {
    getBalance: vi.fn(),
    getSummary: vi.fn()
  };

  beforeEach(async () => {
    wallets.getBalance.mockResolvedValue({
      customerId: "sanga_user_1",
      currency: "XAF",
      balance: "1000000",
      sourceOfTruth: "reepay_ledger"
    });
    wallets.getSummary.mockResolvedValue({
      xaf: { balance: "1000000", currency: "XAF", sourceOfTruth: "reepay_ledger" },
      equivalents: {
        USDC: { amount: "1650.25", currency: "USDC", displayOnly: true },
        EUR: { amount: "1524.49", currency: "EUR", displayOnly: true }
      }
    });

    const moduleRef = await Test.createTestingModule({
      controllers: [WalletsController],
      providers: [{ provide: WalletsService, useValue: wallets }]
    })
      .overrideGuard(ApiKeyGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    vi.clearAllMocks();
  });

  it("keeps the authoritative XAF balance endpoint at GET /v1/wallet/balance", async () => {
    const response = await request(app.getHttpServer()).get("/v1/wallet/balance?customerId=sanga_user_1");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      balance: "1000000",
      currency: "XAF",
      sourceOfTruth: "reepay_ledger"
    });
  });

  it("exposes display equivalents at GET /v1/wallet/summary", async () => {
    const response = await request(app.getHttpServer()).get("/v1/wallet/summary?customerId=sanga_user_1");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      xaf: { balance: "1000000", currency: "XAF" },
      equivalents: {
        USDC: { currency: "USDC", displayOnly: true },
        EUR: { currency: "EUR", displayOnly: true }
      }
    });
  });
});
