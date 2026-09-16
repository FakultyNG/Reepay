import { DepositStatus, Prisma, WalletCurrency, WebhookProcessingStatus } from "@prisma/client";
import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { DepositsService } from "../src/deposits/deposits.service";
import { KryptaPayWebhookService } from "../src/webhooks/kryptapay/kryptapay-webhook.service";
import type { AppConfigService } from "../src/config/app-config.service";
import type { FeeService } from "../src/common/fees/fee.service";
import type { PrismaService } from "../src/database/prisma.service";
import type { KryptaPayClient } from "../src/providers/kryptapay";
import type { KryptaPayWebhookPayload } from "../src/webhooks/kryptapay/kryptapay-webhook.types";
import type { SangaPayWebhookDispatcher } from "../src/webhooks/sangapay";

function sangapayWebhooks() {
  return {
    dispatch: vi.fn().mockResolvedValue({ queued: false, disabled: true, eventId: "rp_evt_test" })
  } as unknown as SangaPayWebhookDispatcher;
}

function feeService(amount = "150") {
  return {
    calculateCustomerFeeDecimal: vi.fn().mockReturnValue(new Prisma.Decimal(amount))
  } as unknown as FeeService;
}

describe("XAF wallet funding", () => {
  it("quotes XAF deposit fees without creating a provider checkout", () => {
    const prisma = {} as unknown as PrismaService;
    const kryptaPay = {
      createPayinCheckout: vi.fn()
    } as unknown as KryptaPayClient;
    const fees = feeService();
    const service = new DepositsService(prisma, kryptaPay, fees, sangapayWebhooks());

    const result = service.createXafDepositQuote({
      amount: "10000",
      network: "MTN_CM",
      phoneNumber: "237670000000"
    });

    expect(kryptaPay.createPayinCheckout).not.toHaveBeenCalled();
    expect(result.amount).toBe("10000");
    expect(result.creditedAmount.amount).toBe("10000");
    expect(result.fees.provider.amount).toBe("0");
    expect(result.fees.reepay.amount).toBe("150");
    expect(result.totalFee.amount).toBe("150");
    expect(result.totalDebit.amount).toBe("10150");
    expect(result.network).toBe("MTN_CM");
    expect(result.phoneNumber).toBe("237670000000");
  });

  it("creates a KryptaPay checkout and records an internal pending XAF deposit", async () => {
    const depositCreate = vi.fn().mockResolvedValue({
      id: "dep_123",
      amount: new Prisma.Decimal("10000"),
      creditedAmount: new Prisma.Decimal("10000"),
      providerFee: new Prisma.Decimal("0"),
      reepayFee: new Prisma.Decimal("150"),
      totalDebit: new Prisma.Decimal("10150"),
      currency: WalletCurrency.XAF,
      status: DepositStatus.PENDING,
      network: "MTN_CM",
      phoneNumber: "237670000000",
      merchantReference: "rp_dep_test",
      providerReference: "tx_123",
      providerTransactionId: "tx_123",
      checkoutUrl: "https://checkout.example",
      checkoutToken: "sbx_123",
      expiresInSec: 900,
      expiresAt: new Date("2026-08-27T00:15:00.000Z"),
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
        amount: "10150",
        currency: "XAF",
        checkoutUrl: "https://checkout.example",
        checkoutToken: "sbx_123",
        expiresInSec: 900,
        expiresAt: "2026-08-27T00:15:00.000Z",
        trace: {
          provider: "kryptapay",
          providerRequestId: "kp_req_123",
          providerTransactionId: "tx_123",
          providerReference: "tx_123",
          merchantReference: "rp_dep_test"
        }
      })
    } as unknown as KryptaPayClient;

    const fees = feeService();
    const service = new DepositsService(prisma, kryptaPay, fees, sangapayWebhooks());

    const result = await service.createXafDeposit(
      {
        customerId: "sanga_user_1",
        amount: "10000",
        network: "MTN_CM",
        phoneNumber: "237670000000",
        fullName: "Jane Doe",
        expiresInSec: 900
      },
      "req_123",
      "idem_123"
    );

    expect(kryptaPay.createPayinCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: "10150",
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
          creditedAmount: expect.any(Prisma.Decimal),
          providerFee: expect.any(Prisma.Decimal),
          reepayFee: expect.any(Prisma.Decimal),
          totalDebit: expect.any(Prisma.Decimal),
          currency: WalletCurrency.XAF,
          status: DepositStatus.PENDING,
          provider: "kryptapay",
          providerReference: "tx_123",
          idempotencyKey: "idem_123"
        })
      })
    );
    expect(result.status).toBe("pending");
    expect(result.amount).toBe("10000");
    expect(result.fees.reepay.amount).toBe("150");
    expect(result.reepayFee.amount).toBe("150");
    expect(result.totalFee.amount).toBe("150");
    expect(result.totalDebit.amount).toBe("10150");
    expect(result.expiresInSec).toBe(900);
    expect(result.expiresAt).toBe("2026-08-27T00:15:00.000Z");
  });

  it("reconciles and returns the refreshed deposit when manual verification sees a completed payin", async () => {
    const pendingDeposit = {
      id: "dep_123",
      amount: new Prisma.Decimal("10000"),
      creditedAmount: new Prisma.Decimal("10000"),
      providerFee: new Prisma.Decimal("0"),
      reepayFee: new Prisma.Decimal("150"),
      totalDebit: new Prisma.Decimal("10150"),
      currency: WalletCurrency.XAF,
      status: DepositStatus.PENDING,
      network: "MTN_CM",
      phoneNumber: "237670000000",
      merchantReference: "rp_dep_test",
      providerReference: "tx_123",
      providerTransactionId: "tx_123",
      checkoutUrl: "https://checkout.example",
      checkoutToken: "sbx_123",
      expiresInSec: 900,
      expiresAt: new Date("2026-08-27T00:15:00.000Z"),
      failureReason: null,
      createdAt: new Date("2026-08-27T00:00:00.000Z"),
      updatedAt: new Date("2026-08-27T00:00:00.000Z"),
      completedAt: null
    };
    const completedDeposit = {
      ...pendingDeposit,
      status: DepositStatus.COMPLETED,
      completedAt: new Date("2026-08-27T00:02:00.000Z")
    };
    const prisma = {
      deposit: {
        findUnique: vi.fn()
          .mockResolvedValueOnce(pendingDeposit)
          .mockResolvedValueOnce(completedDeposit)
      }
    } as unknown as PrismaService;
    const kryptaPay = {
      getPayinStatus: vi.fn().mockResolvedValue({
        reference: "tx_123",
        status: "completed",
        amount: "10150",
        currency: "XAF",
        trace: {
          provider: "kryptapay",
          providerTransactionId: "tx_123",
          providerReference: "tx_123",
          merchantReference: "rp_dep_test"
        }
      })
    } as unknown as KryptaPayClient;
    const service = new DepositsService(prisma, kryptaPay, feeService(), sangapayWebhooks());
    const reconcile = vi.spyOn(service, "reconcileProviderDepositStatus").mockResolvedValue({
      reconciled: true,
      status: "completed"
    });

    const result = await service.verifyDeposit("dep_123", "req_123");

    expect(reconcile).toHaveBeenCalledWith("dep_123", "req_123");
    expect(result.status).toBe("completed");
    expect(result.amount).toBe("10000");
    expect(result.totalFee.amount).toBe("150");
    expect(result.totalDebit.amount).toBe("10150");
    expect(result.verification).toMatchObject({
      verified: true,
      status: "completed",
      amount: "10150",
      expectedAmount: "10150"
    });
  });

  it("reconciles a pending deposit when status is polled", async () => {
    const pendingDeposit = {
      id: "dep_123",
      amount: new Prisma.Decimal("10000"),
      creditedAmount: new Prisma.Decimal("10000"),
      providerFee: new Prisma.Decimal("0"),
      reepayFee: new Prisma.Decimal("150"),
      totalDebit: new Prisma.Decimal("10150"),
      currency: WalletCurrency.XAF,
      status: DepositStatus.PENDING,
      network: "MTN_CM",
      phoneNumber: "237670000000",
      merchantReference: "rp_dep_test",
      providerReference: "tx_123",
      providerTransactionId: "tx_123",
      checkoutUrl: "https://checkout.example",
      checkoutToken: "sbx_123",
      expiresInSec: 900,
      expiresAt: new Date("2026-08-27T00:15:00.000Z"),
      failureReason: null,
      createdAt: new Date("2026-08-27T00:00:00.000Z"),
      updatedAt: new Date("2026-08-27T00:00:00.000Z"),
      completedAt: null
    };
    const completedDeposit = {
      ...pendingDeposit,
      status: DepositStatus.COMPLETED,
      completedAt: new Date("2026-08-27T00:02:00.000Z")
    };
    const prisma = {
      deposit: {
        findUnique: vi.fn()
          .mockResolvedValueOnce(pendingDeposit)
          .mockResolvedValueOnce(completedDeposit)
      }
    } as unknown as PrismaService;
    const service = new DepositsService(prisma, {} as KryptaPayClient, feeService(), sangapayWebhooks());
    const reconcile = vi.spyOn(service, "reconcileProviderDepositStatus").mockResolvedValue({
      reconciled: true,
      status: "completed"
    });

    const result = await service.getDepositStatus("dep_123", "req_123");

    expect(reconcile).toHaveBeenCalledWith("dep_123", "req_123");
    expect(result.status).toBe("completed");
    expect(result.totalFee.amount).toBe("150");
  });

  it("credits the Reepay ledger after a signed PAYIN_RECEIVED webhook and provider status verification", async () => {
    const payload: KryptaPayWebhookPayload = {
      event_id: "evt_123",
      event_type: "PAYIN_RECEIVED",
      created_at: "2026-08-27T00:00:00.000Z",
      data: {
        transaction_id: "tx_123",
        reference: "tx_123",
        amount: "10150",
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
        findFirst: vi.fn().mockResolvedValue({
          id: "dep_123",
          customerId: "customer_123",
          amount: new Prisma.Decimal("10000"),
          creditedAmount: new Prisma.Decimal("10000"),
          providerFee: new Prisma.Decimal("0"),
          reepayFee: new Prisma.Decimal("150"),
          totalDebit: new Prisma.Decimal("10150"),
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
      reepayFeeEarning: {
        createMany: vi.fn()
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
        amount: "10150",
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
    expect(tx.deposit.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            { providerReference: "tx_123" },
            { providerTransactionId: "provider_tx_123" }
          ])
        })
      })
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
    expect(tx.reepayFeeEarning.createMany).toHaveBeenCalledWith({
      data: [
        {
          sourceType: "DEPOSIT",
          sourceId: "dep_123",
          amount: new Prisma.Decimal("150"),
          currency: WalletCurrency.XAF,
          depositId: "dep_123"
        }
      ],
      skipDuplicates: true
    });
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
