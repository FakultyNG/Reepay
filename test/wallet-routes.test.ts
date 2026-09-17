import { VersioningType } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiKeyGuard } from "../src/auth";
import { WalletConversionsService } from "../src/wallets/wallet-conversions.service";
import { WalletsController } from "../src/wallets/wallets.controller";
import { WalletsService } from "../src/wallets/wallets.service";
import type { INestApplication } from "@nestjs/common";

describe("Wallet routes", () => {
  let app: INestApplication;
  const wallets = {
    getBalance: vi.fn(),
    getSummary: vi.fn()
  };
  const conversions = {
    getCustomerConversion: vi.fn()
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
    conversions.getCustomerConversion.mockResolvedValue({
      id: "conversion_123",
      status: "processing"
    });

    const moduleRef = await Test.createTestingModule({
      controllers: [WalletsController],
      providers: [
        { provide: WalletsService, useValue: wallets },
        { provide: WalletConversionsService, useValue: conversions }
      ]
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

  it("returns only the authenticated customer's wallet conversion status", async () => {
    const response = await request(app.getHttpServer()).get(
      "/v1/wallet/conversions/conversion_123?customerId=sanga_user_1"
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id: "conversion_123", status: "processing" });
    expect(conversions.getCustomerConversion).toHaveBeenCalledWith(
      "conversion_123",
      "sanga_user_1"
    );
  });
});
