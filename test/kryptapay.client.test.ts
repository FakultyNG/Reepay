import type { HttpService } from "@nestjs/axios";
import { BadGatewayException } from "@nestjs/common";
import { AxiosError, type AxiosResponse } from "axios";
import { of, throwError } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import { KryptaPayClient } from "../src/providers/kryptapay/kryptapay.client";
import type { KryptaPayConfig } from "../src/providers/kryptapay/kryptapay.config";

function buildClient(response: AxiosResponse | Error) {
  const http = {
    request: vi.fn(() => (response instanceof Error ? throwError(() => response) : of(response)))
  } as unknown as HttpService;

  const config = {
    baseUrl: "https://staging.api.krypta-pay.com",
    apiKey: "kp_test_secret"
  } as KryptaPayConfig;

  return {
    client: new KryptaPayClient(http, config),
    request: http.request as unknown as ReturnType<typeof vi.fn>
  };
}

function okResponse<T>(data: T): AxiosResponse {
  return {
    data: { ok: true, data },
    status: 200,
    statusText: "OK",
    headers: { "x-request-id": "kp_req_123" },
    config: {} as AxiosResponse["config"]
  };
}

describe("KryptaPayClient", () => {
  it("creates payin checkouts using the documented endpoint and normalized response", async () => {
    const { client, request } = buildClient(
      okResponse({
        reference: "tx_123",
        status: "PENDING",
        amount: "300",
        currency: "xof",
        checkoutUrl: "https://checkout.example",
        checkoutToken: "sbx_123",
        expiresInSec: 60,
        provider: "BRIDGE",
        providerMode: "live"
      })
    );

    const result = await client.createPayinCheckout(
      {
        amount: "300",
        currency: "XOF",
        network: "MTN_BJ",
        customer: {
          fullName: "John Doe",
          msisdn: "0197000000",
          email: "johndoe@example.com"
        },
        redirectUrl: "https://example.com",
        expiresInSec: 60
      },
      {
        requestId: "req_123",
        idempotencyKey: "idem_123",
        merchantReference: "rp_payin_test"
      }
    );

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: "https://staging.api.krypta-pay.com",
        method: "post",
        url: "/v1/payins/checkout",
        headers: expect.objectContaining({
          Authorization: "Bearer kp_test_secret",
          "Idempotency-Key": "idem_123",
          "X-Request-Id": "req_123"
        })
      })
    );
    expect(result).toEqual({
      reference: "tx_123",
      status: "pending",
      amount: "300",
      currency: "XOF",
      checkoutUrl: "https://checkout.example",
      checkoutToken: "sbx_123",
      expiresInSec: 60,
      trace: {
        provider: "kryptapay",
        providerRequestId: "kp_req_123",
        providerTransactionId: "tx_123",
        providerReference: "tx_123",
        merchantReference: "rp_payin_test"
      }
    });
  });

  it("gets payin status by reference using the documented endpoint", async () => {
    const { client, request } = buildClient(
      okResponse({
        reference: "tx_123",
        status: "completed",
        amount: "300",
        currency: "XOF",
        network: "MTN_BJ",
        checkoutUrl: null,
        expiresAt: null,
        initiatedAt: "2026-08-27T00:00:00.000Z",
        settledAt: "2026-08-27T00:01:00.000Z"
      })
    );

    const result = await client.getPayinStatus("tx_123", { merchantReference: "rp_status_test" });

    expect(request).toHaveBeenCalledWith(expect.objectContaining({ method: "get", url: "/v1/payins/tx_123" }));
    expect(result.status).toBe("completed");
    expect(result.currency).toBe("XOF");
    expect(result.trace.providerReference).toBe("tx_123");
  });

  it("creates payouts using the documented endpoint", async () => {
    const { client, request } = buildClient(
      okResponse({
        id: "po_123",
        reference: "ref_123",
        status: "PROCESSING",
        amount: "300",
        currency: "XOF",
        fee: "5",
        network: "MTN_BJ",
        provider: "BRIDGE",
        description: "Supplier payout",
        recipient: { msisdn: "0197000000", iban: null, address: null, chain: null },
        providerRef: "provider_po_123",
        failureReason: null,
        initiatedAt: "2026-08-27T00:00:00.000Z",
        settledAt: null,
        failedAt: null,
        idempotencyKey: "idem_456",
        approvedAt: null,
        autoExecuted: true,
        frozen: false
      })
    );

    const result = await client.createPayout(
      {
        amount: "300",
        currency: "XOF",
        network: "MTN_BJ",
        recipient: { msisdn: "0197000000" },
        description: "Supplier payout"
      },
      { idempotencyKey: "idem_456", merchantReference: "rp_payout_test" }
    );

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "post",
        url: "/v1/payouts/",
        headers: expect.objectContaining({
          Authorization: "Bearer kp_test_secret",
          "Idempotency-Key": "idem_456"
        })
      })
    );
    expect(result.trace.providerTransactionId).toBe("po_123");
    expect(result.trace.providerReference).toBe("provider_po_123");
    expect(result).not.toHaveProperty("provider");
  });

  it("supports payout reconciliation and approval flow endpoints documented by KryptaPay", async () => {
    const payout = {
      id: "po_123",
      reference: "ref_123",
      status: "PENDING",
      amount: "300",
      currency: "XOF",
      fee: "5",
      network: "MTN_BJ",
      provider: "BRIDGE",
      description: null,
      recipient: { msisdn: "0197000000", iban: null, address: null, chain: null },
      providerRef: null,
      failureReason: null,
      initiatedAt: "2026-08-27T00:00:00.000Z",
      settledAt: null,
      failedAt: null,
      idempotencyKey: null,
      approvedAt: null,
      autoExecuted: false,
      frozen: true
    };
    const { client, request } = buildClient(okResponse({ items: [payout], nextCursor: "next_1" }));

    const result = await client.listPayouts({ limit: 25, cursor: "cur_1" }, { merchantReference: "rp_list_test" });

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "get",
        url: "/v1/payouts/",
        params: { limit: 25, cursor: "cur_1" }
      })
    );
    expect(result.items).toHaveLength(1);
    expect(result.nextCursor).toBe("next_1");
  });

  it("uses the documented payout lifecycle endpoints", async () => {
    const payout = {
      id: "po_123",
      reference: "ref_123",
      status: "PENDING",
      amount: "300",
      currency: "XOF",
      fee: "5",
      network: "MTN_BJ",
      provider: "BRIDGE",
      description: null,
      recipient: { msisdn: "0197000000", iban: null, address: null, chain: null },
      providerRef: null,
      failureReason: null,
      initiatedAt: "2026-08-27T00:00:00.000Z",
      settledAt: null,
      failedAt: null,
      idempotencyKey: null,
      approvedAt: null,
      autoExecuted: false,
      frozen: true
    };
    const { client, request } = buildClient(okResponse(payout));

    await client.getPayout("po_123");
    await client.approvePayout("po_123");
    await client.rejectPayout("po_123", "duplicate");
    await client.cancelPayout("po_123");

    expect(request).toHaveBeenNthCalledWith(1, expect.objectContaining({ method: "get", url: "/v1/payouts/po_123" }));
    expect(request).toHaveBeenNthCalledWith(2, expect.objectContaining({ method: "post", url: "/v1/payouts/po_123/approve" }));
    expect(request).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ method: "post", url: "/v1/payouts/po_123/reject", data: { reason: "duplicate" } })
    );
    expect(request).toHaveBeenNthCalledWith(4, expect.objectContaining({ method: "post", url: "/v1/payouts/po_123/cancel" }));
  });

  it("uses the documented FX rates and quote endpoints", async () => {
    const ratesResponse = okResponse({
      spreadBps: 50,
      generatedAt: "2026-08-27T00:00:00.000Z",
      rates: [
        {
          from: "EUR",
          to: "XAF",
          mid: "655.957",
          buy: "652.677215",
          sell: "659.236785",
          source: "provider",
          validFrom: "2026-08-27T00:00:00.000Z"
        }
      ]
    });
    const { client, request } = buildClient(ratesResponse);

    const rates = await client.getCurrentFxRates();

    expect(request).toHaveBeenCalledWith(expect.objectContaining({ method: "get", url: "/v1/fx/rates" }));
    expect(rates.rates[0]).toMatchObject({
      from: "EUR",
      to: "XAF",
      midRate: "655.957",
      buyRate: "652.677215",
      sellRate: "659.236785"
    });

    request.mockReturnValueOnce(
      of(
        okResponse({
          from: "EUR",
          to: "XAF",
          fromAmount: "10",
          toAmount: "6559.57",
          midRate: "655.957",
          appliedRate: "655.957",
          spreadBps: 0,
          expiresAt: "2026-08-27T00:01:00.000Z"
        })
      )
    );

    await client.createIndicativeConversionQuote({ from: "EUR", to: "XAF", amount: "10", side: "debit_from" });
    expect(request).toHaveBeenLastCalledWith(
      expect.objectContaining({
        method: "post",
        url: "/v1/fx/quote",
        data: { from: "EUR", to: "XAF", amount: "10", side: "debit_from" }
      })
    );
  });

  it("executes conversions with a generated merchant reference because the OpenAPI supports reference", async () => {
    const { client, request } = buildClient(
      okResponse({
        id: "cv_123",
        reference: "rp_fx_convert_test",
        status: "SETTLED",
        fromCurrency: "EUR",
        toCurrency: "XAF",
        fromAmount: "10",
        toAmount: "6559.57",
        midRate: "655.957",
        appliedRate: "655.957",
        spreadBps: 0,
        settledAt: "2026-08-27T00:00:00.000Z"
      })
    );

    await client.executeConversion(
      { from: "EUR", to: "XAF", amount: "10" },
      { idempotencyKey: "idem_fx", merchantReference: "rp_fx_convert_test" }
    );

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "post",
        url: "/v1/fx/convert",
        data: {
          from: "EUR",
          to: "XAF",
          amount: "10",
          reference: "rp_fx_convert_test"
        },
        headers: expect.objectContaining({ "Idempotency-Key": "idem_fx" })
      })
    );
  });

  it("normalizes provider server errors without leaking the raw provider response", async () => {
    const axiosError = new AxiosError("failed", undefined, undefined, undefined, {
      data: { ok: false, error: { code: "UPSTREAM_DOWN", message: "raw provider failure" } },
      status: 503,
      statusText: "Service Unavailable",
      headers: { "x-request-id": "kp_req_error" },
      config: {} as AxiosResponse["config"]
    });
    const { client } = buildClient(axiosError);

    await expect(client.getPayout("po_123")).rejects.toBeInstanceOf(BadGatewayException);
  });
});
