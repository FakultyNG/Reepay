import { DepositStatus, Prisma, WalletCurrency, WebhookProcessingStatus } from "@prisma/client";
import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { DepositsService } from "../src/deposits/deposits.service";
import { KryptaPayWebhookService } from "../src/webhooks/kryptapay/kryptapay-webhook.service";
import type { AppConfigService } from "../src/config/app-config.service";
import type { PrismaService } from "../src/database/prisma.service";
import type { KryptaPayClient } from "../src/providers/kryptapay";
import type { KryptaPayWebhookPayload } from "../src/webhooks/kryptapay/kryptapay-webhook.types";
import type { SangaPayWebhookDispatcher } from "../src/webhooks/sangapay";

function sangapayWebhooks() {
  return {
    dispatch: vi.fn().mockResolvedValue({ queued: false, disabled: true, eventId: "rp_evt_test" })
  } as unknown as SangaPayWebhookDispatcher;
}

describe("XAF wallet funding", () => {
  it("creates a KryptaPay checkout and records an internal pending XAF deposit", async () => {
    const depositCreate = vi.fn().mockResolvedValue({
      id: "dep_123",
      amount: new Prisma.Decimal("10000"),
      currency: WalletCurrency.XAF,
      status: DepositStatus.PENDING,
      network: "MTN_CM",
      phoneNumber: "237670000000",
      merchantReference: "rp_dep_test",
      providerReference: "tx_123",
      providerTransactionId: "tx_123",
      checkoutUrl: "https://checkout.example",
      checkoutToken: "sbx_123",
      failureReason: null,
      createdAt: new Date("2026-08-27T00:00:00.000Z"),
      updatedAt: new Date("2026-08-27T00:00:00.000Z"),
      completedAt: null
    });
    const prisma = {
      deposit: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: depositCreate
      }
    } as unknown as PrismaService;
    const kryptaPay = {
      createPayinCheckout: vi.fn().mockResolvedValue({
        reference: "tx_123",
        status: "pending",
        amount: "10000",
        currency: "XAF",
        checkoutUrl: "https://checkout.example",
        checkoutToken: "sbx_123",
        trace: {
          provider: "kryptapay",
          providerRequestId: "kp_req_123",
          providerTransactionId: "tx_123",
          providerReference: "tx_123",
          merchantReference: "rp_dep_test"
        }
      })
    } as unknown as KryptaPayClient;

    const service = new DepositsService(prisma, kryptaPay, sangapayWebhooks());

    const result = await service.createXafDeposit(
      {
        customerId: "sanga_user_1",
        amount: "10000",
        network: "MTN_CM",
        phoneNumber: "237670000000",
        fullName: "Jane Doe"
      },
      "req_123",
      "idem_123"
    );

    expect(kryptaPay.createPayinCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: "10000",
        currency: "XAF",
        network: "MTN_CM",
        customer: expect.objectContaining({ msisdn: "237670000000" })
      }),
      expect.objectContaining({
        requestId: "req_123",
        idempotencyKey: "idem_123"
      })
    );
    expect(depositCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          amount: expect.any(Prisma.Decimal),
          currency: WalletCurrency.XAF,
          status: DepositStatus.PENDING,
          provider: "kryptapay",
          providerReference: "tx_123",
          idempotencyKey: "idem_123"
        })
      })
    );
    expect(result.status).toBe("pending");
  });

  it("credits the Reepay ledger after a signed PAYIN_RECEIVED webhook and provider status verification", async () => {
    const payload: KryptaPayWebhookPayload = {
      event_id: "evt_123",
      event_type: "PAYIN_RECEIVED",
      created_at: "2026-08-27T00:00:00.000Z",
      data: {
        transaction_id: "tx_123",
        reference: "tx_123",
        amount: "10000",
        currency: "XAF",
        network: "MTN_CM",
        status: "COMPLETED",
        provider_ref: "provider_tx_123"
      }
    };
    const rawBody = Buffer.from(JSON.stringify(payload));
    const signature = createHmac("sha256", "whsec_test").update(rawBody).digest("hex");

    const tx = {
      deposit: {
        findUnique: vi.fn().mockResolvedValue({
          id: "dep_123",
          customerId: "customer_123",
          amount: new Prisma.Decimal("10000"),
          currency: WalletCurrency.XAF,
          status: DepositStatus.PENDING,
          providerReference: "tx_123",
          providerTransactionId: "tx_123",
          merchantReference: "rp_dep_123",
          customer: { id: "customer_123", externalId: "sanga_user_1" }
        }),
        update: vi.fn()
      },
      wallet: {
        upsert: vi.fn().mockResolvedValue({
          id: "wallet_123",
          balance: new Prisma.Decimal("10000")
        })
      },
      transaction: {
        create: vi.fn().mockResolvedValue({ id: "txn_123" })
      },
      ledgerEntry: {
        create: vi.fn()
      },
      notificationEvent: {
        create: vi.fn()
      },
      webhookLog: {
        update: vi.fn()
      }
    };
    const prisma = {
      webhookLog: {
        create: vi.fn().mockResolvedValue({ id: "evt_db_123" }),
        update: vi.fn()
      },
      $transaction: vi.fn((callback: (client: typeof tx) => Promise<void>) => callback(tx))
    } as unknown as PrismaService;
    const kryptaPay = {
      getPayinStatus: vi.fn().mockResolvedValue({
        reference: "tx_123",
        status: "completed",
        amount: "10000",
        currency: "XAF",
        trace: {
          provider: "kryptapay",
          providerTransactionId: "tx_123",
          providerReference: "tx_123",
          merchantReference: "rp_webhook_evt_123"
        }
      })
    } as unknown as KryptaPayClient;
    const config = {
      kryptapay: {
        webhookSecret: "whsec_test"
      }
    } as AppConfigService;

    const sangaWebhooks = sangapayWebhooks();
    const service = new KryptaPayWebhookService(config, prisma, kryptaPay, {} as never, sangaWebhooks, {} as never);
    const result = await service.handleWebhook(payload, rawBody, signature, "req_123");

    expect(result).toEqual({ received: true });
    expect(kryptaPay.getPayinStatus).toHaveBeenCalledWith(
      "tx_123",
      expect.objectContaining({ requestId: "req_123" })
    );
    expect(tx.wallet.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { balance: { increment: new Prisma.Decimal("10000") } }
      })
    );
    expect(tx.ledgerEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "CREDIT",
          amount: new Prisma.Decimal("10000"),
          balanceAfter: new Prisma.Decimal("10000")
        })
      })
    );
    expect(tx.deposit.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: DepositStatus.COMPLETED })
      })
    );
    expect(tx.notificationEvent.create).toHaveBeenCalled();
    expect(sangaWebhooks.dispatch).toHaveBeenCalledWith(
      "deposit.completed",
      expect.objectContaining({
        customerId: "sanga_user_1",
        depositId: "dep_123",
        transactionId: "txn_123",
        amount: "10000",
        currency: WalletCurrency.XAF,
        status: "completed",
        reference: "rp_dep_123"
      }),
      "req_123"
    );
  });

  it("acknowledges duplicate webhook event IDs without crediting again", async () => {
    const payload = {
      event_id: "evt_123",
      event_type: "PAYIN_RECEIVED",
      created_at: "2026-08-27T00:00:00.000Z",
      data: {
        transaction_id: "tx_123",
        reference: "tx_123",
        status: "COMPLETED"
      }
    } as KryptaPayWebhookPayload;
    const rawBody = Buffer.from(JSON.stringify(payload));
    const signature = createHmac("sha256", "whsec_test").update(rawBody).digest("hex");
    const duplicateError = new Prisma.PrismaClientKnownRequestError("duplicate", {
      code: "P2002",
      clientVersion: "test"
    });
    const prisma = {
      webhookLog: {
        create: vi.fn().mockRejectedValue(duplicateError)
      },
      $transaction: vi.fn()
    } as unknown as PrismaService;
    const service = new KryptaPayWebhookService(
      { kryptapay: { webhookSecret: "whsec_test" } } as AppConfigService,
      prisma,
      { getPayinStatus: vi.fn() } as unknown as KryptaPayClient,
      {} as never,
      sangapayWebhooks(),
      {} as never
    );

    await expect(service.handleWebhook(payload, rawBody, signature)).resolves.toEqual({
      received: true,
      duplicate: true
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("persists raw webhook payloads and processing status", async () => {
    const payload = {
      event_id: "evt_created_123",
      event_type: "PAYIN_CREATED",
      created_at: "2026-08-27T00:00:00.000Z",
      data: {
        transaction_id: "tx_123",
        reference: "tx_123",
        status: "PENDING"
      }
    } as KryptaPayWebhookPayload;
    const rawBody = Buffer.from(JSON.stringify(payload));
    const signature = createHmac("sha256", "whsec_test").update(rawBody).digest("hex");
    const webhookLogUpdate = vi.fn();
    const prisma = {
      webhookLog: {
        create: vi.fn().mockResolvedValue({ id: "evt_db_123" }),
        update: webhookLogUpdate
      }
    } as unknown as PrismaService;
    const service = new KryptaPayWebhookService(
      { kryptapay: { webhookSecret: "whsec_test" } } as AppConfigService,
      prisma,
      {} as KryptaPayClient,
      {} as never,
      sangapayWebhooks(),
      {} as never
    );

    await expect(service.handleWebhook(payload, rawBody, signature, "kp_req_123")).resolves.toEqual({
      received: true
    });
    expect(prisma.webhookLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          provider: "kryptapay",
          eventId: "evt_created_123",
          eventType: "PAYIN_CREATED",
          signatureValid: true,
          rawPayload: rawBody.toString("utf8"),
          processingStatus: WebhookProcessingStatus.PENDING,
          providerRequestId: "kp_req_123"
        })
      })
    );
    expect(webhookLogUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          processingStatus: WebhookProcessingStatus.PROCESSED
        })
      })
    );
  });

  it("rejects unsigned or incorrectly signed webhooks", async () => {
    const payload = {
      event_id: "evt_123",
      event_type: "PAYIN_RECEIVED",
      created_at: "2026-08-27T00:00:00.000Z",
      data: {
        transaction_id: "tx_123",
        reference: "tx_123",
        status: "COMPLETED"
      }
    } as KryptaPayWebhookPayload;
    const service = new KryptaPayWebhookService(
      { kryptapay: { webhookSecret: "whsec_test" } } as AppConfigService,
      { webhookLog: { create: vi.fn() } } as unknown as PrismaService,
      {} as KryptaPayClient,
      {} as never,
      sangapayWebhooks(),
      {} as never
    );

    await expect(service.handleWebhook(payload, Buffer.from(JSON.stringify(payload)), "bad")).rejects.toThrow();
  });
});
