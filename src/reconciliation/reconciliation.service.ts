import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import {
  DepositStatus,
  PayoutStatus,
  WalletConversionStatus
} from "@prisma/client";
import { randomUUID } from "node:crypto";
import { JsonLogger } from "../common/logging/json-logger";
import { AppConfigService } from "../config/app-config.service";
import { PrismaService } from "../database/prisma.service";
import { DepositsService } from "../deposits/deposits.service";
import { PayoutsService } from "../payouts/payouts.service";
import { WalletConversionsService } from "../wallets/wallet-conversions.service";
import { SangaPayWebhookDispatcher } from "../webhooks/sangapay";

@Injectable()
export class ReconciliationService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @Inject(AppConfigService) private readonly config: AppConfigService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(DepositsService) private readonly deposits: DepositsService,
    @Inject(PayoutsService) private readonly payouts: PayoutsService,
    @Inject(WalletConversionsService) private readonly conversions: WalletConversionsService,
    @Inject(SangaPayWebhookDispatcher) private readonly sangapayWebhooks: SangaPayWebhookDispatcher,
    @Inject(JsonLogger) private readonly logger: JsonLogger
  ) {}

  onModuleInit() {
    const settings = this.config.reconciliation;
    if (!settings.enabled) {
      return;
    }

    this.timer = setInterval(() => {
      void this.runScheduledPass().catch((error: unknown) => {
        this.logger.error("scheduled reconciliation failed", error instanceof Error ? error.stack : undefined, {
          error: error instanceof Error ? error.message : "Unknown reconciliation failure"
        });
      });
    }, settings.intervalMs);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  async runScheduledPass() {
    if (this.running) {
      return { skipped: true, reason: "already_running" };
    }

    this.running = true;
    try {
      return await this.reconcileRecent();
    } finally {
      this.running = false;
    }
  }

  async reconcileRecent() {
    const settings = this.config.reconciliation;
    const requestId = `rp_recon_${randomUUID()}`;
    const since = new Date(Date.now() - settings.lookbackMinutes * 60_000);

    const [deposits, payouts, conversions] = await Promise.all([
      this.prisma.deposit.findMany({
        where: {
          createdAt: { gte: since },
          status: { in: [DepositStatus.PENDING, DepositStatus.PROCESSING] },
          providerReference: { not: "" }
        },
        orderBy: { createdAt: "asc" },
        take: settings.batchSize
      }),
      this.prisma.payout.findMany({
        where: {
          createdAt: { gte: since },
          status: { in: [PayoutStatus.PENDING, PayoutStatus.PROCESSING] },
          OR: [{ providerReference: { not: null } }, { providerTransactionId: { not: null } }]
        },
        orderBy: { createdAt: "asc" },
        take: settings.batchSize
      }),
      this.prisma.walletConversion.findMany({
        where: {
          createdAt: { gte: since },
          status: { in: [WalletConversionStatus.PENDING, WalletConversionStatus.PROCESSING] },
          OR: [{ providerReference: { not: null } }, { providerTransactionId: { not: null } }]
        },
        orderBy: { createdAt: "asc" },
        take: settings.batchSize
      })
    ]);

    const summary = {
      deposits: await this.reconcileRows(deposits.map((deposit) => deposit.id), (id) =>
        this.deposits.reconcileProviderDepositStatus(id, requestId)
      ),
      payouts: await this.reconcileRows(payouts.map((payout) => payout.id), (id) =>
        this.payouts.reconcileProviderPayoutStatus(id, requestId)
      ),
      walletConversions: await this.reconcileRows(conversions.map((conversion) => conversion.id), (id) =>
        this.conversions.reconcileProviderConversionStatus(id, requestId)
      ),
      outboundWebhooks: await this.sangapayWebhooks.retryFailedDeliveries(settings.batchSize, requestId)
    };

    this.logger.log("reconciliation pass completed", {
      requestId,
      summary
    });

    return {
      requestId,
      summary
    };
  }

  private async reconcileRows<T>(ids: string[], handler: (id: string) => Promise<T>) {
    let checked = 0;
    let reconciled = 0;
    let failed = 0;

    for (const id of ids) {
      checked += 1;
      try {
        const result = await handler(id);
        if (isReconciledResult(result)) {
          reconciled += 1;
        }
      } catch (error) {
        failed += 1;
        this.logger.error("reconciliation row failed", error instanceof Error ? error.stack : undefined, {
          id,
          error: error instanceof Error ? error.message : "Unknown reconciliation row failure"
        });
      }
    }

    return { checked, reconciled, failed };
  }
}

function isReconciledResult(result: unknown) {
  return Boolean(result && typeof result === "object" && "reconciled" in result && result.reconciled === true);
}
