import { VersioningType } from "@nestjs/common";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { WalletCurrency } from "@prisma/client";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiKeyGuard } from "../src/auth/api-key.guard";
import { PayoutsController } from "../src/payouts/payouts.controller";
import { PayoutsService } from "../src/payouts/payouts.service";
import { WalletConversionsService } from "../src/wallets/wallet-conversions.service";

describe("Multi-currency payout routes", () => {
  let app: INestApplication;
  const payouts = {
    createEurIbanPayoutQuote: vi.fn(),
    confirmEurIbanPayout: vi.fn(),
    createEurWiseTagPayoutQuote: vi.fn(),
    confirmEurWiseTagPayout: vi.fn(),
    createUsdcAddressPayoutQuote: vi.fn(),
    confirmUsdcAddressPayout: vi.fn(),
    createEurPayoutQuote: vi.fn(),
    validateRecipient: vi.fn(),
    confirmEurPayout: vi.fn(),
    getPayoutStatus: vi.fn()
  };
  const conversions = {
    confirm: vi.fn()
  };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [PayoutsController],
      providers: [
        { provide: PayoutsService, useValue: payouts },
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
    await app?.close();
    vi.clearAllMocks();
  });

  it("routes EUR and USDC wallet funding aliases through wallet conversion confirmation", async () => {
    conversions.confirm.mockResolvedValue({ id: "conversion_123" });

    await request(app.getHttpServer())
      .post("/v1/payouts/eur/confirm")
      .set("Idempotency-Key", "idem_eur_123")
      .send({ quoteId: "quote_eur_123" })
      .expect(201);

    const response = await request(app.getHttpServer())
      .post("/v1/payouts/usdc/confirm")
      .set("Idempotency-Key", "idem_123")
      .send({ quoteId: "quote_123" });

    expect(response.status).toBe(201);
    expect(conversions.confirm).toHaveBeenCalledWith(
      { quoteId: "quote_eur_123" },
      WalletCurrency.EUR,
      undefined,
      "idem_eur_123"
    );
    expect(conversions.confirm).toHaveBeenCalledWith(
      { quoteId: "quote_123" },
      WalletCurrency.USDC,
      undefined,
      "idem_123"
    );
  });

  it("routes explicit external payout quote endpoints", async () => {
    payouts.createEurWiseTagPayoutQuote.mockResolvedValue({ id: "eur_wisetag_quote" });
    payouts.createUsdcAddressPayoutQuote.mockResolvedValue({ id: "usdc_address_quote" });

    await request(app.getHttpServer())
      .post("/v1/payouts/eur/wisetag/quote")
      .send({ customerId: "cust_123", amount: "25", wiseTag: "@recipient" })
      .expect(201);
    await request(app.getHttpServer())
      .post("/v1/payouts/usdc/address/quote")
      .send({ customerId: "cust_123", amount: "25", network: "POLYGON", address: "0xabc" })
      .expect(201);

    expect(payouts.createEurWiseTagPayoutQuote).toHaveBeenCalled();
    expect(payouts.createUsdcAddressPayoutQuote).toHaveBeenCalled();
  });
});
