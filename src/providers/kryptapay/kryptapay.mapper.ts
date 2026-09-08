import type {
  ConversionQuoteResult,
  ConversionResult,
  FxRatesResult
} from "./interfaces/kryptapay-fx-provider.interface";
import type { PayinResult } from "./interfaces/kryptapay-payment-provider.interface";
import type { ListPayoutsResult, PayoutResult } from "./interfaces/kryptapay-payout-provider.interface";
import type {
  MoneyCurrency,
  PaymentNetwork,
  ProviderOperationContext,
  ProviderTrace,
  ProviderTransactionStatus
} from "../types";
import { randomUUID } from "node:crypto";

type KryptaPayEnvelope<T> = {
  ok: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
};

type KryptaPayStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED" | "CANCELLED" | "REFUNDED";

type KryptaPayPayin = {
  reference: string;
  status: KryptaPayStatus;
  amount: string;
  currency: MoneyCurrency;
  network?: PaymentNetwork | null;
  checkoutUrl?: string | null;
  checkoutToken?: string | null;
  expiresInSec?: number;
  expiresAt?: string | null;
  initiatedAt?: string;
  settledAt?: string | null;
};

type KryptaPayPayout = {
  id: string;
  reference: string;
  status: KryptaPayStatus;
  amount: string;
  currency: MoneyCurrency;
  fee?: string;
  network?: PaymentNetwork | null;
  description?: string | null;
  recipient?: {
    msisdn?: string | null;
    iban?: string | null;
    address?: string | null;
    chain?: PaymentNetwork | null;
  };
  providerRef?: string | null;
  failureReason?: string | null;
  initiatedAt?: string;
  settledAt?: string | null;
  failedAt?: string | null;
  idempotencyKey?: string | null;
  approvedAt?: string | null;
  autoExecuted?: boolean;
  frozen?: boolean;
};

type KryptaPayPayoutList = {
  items: KryptaPayPayout[];
  nextCursor?: string | null;
};

type KryptaPayFxRates = {
  spreadBps: number;
  generatedAt: string;
  rates: Array<{
    from: MoneyCurrency;
    to: MoneyCurrency;
    mid: string;
    buy: string;
    sell: string;
    source: string;
    validFrom: string;
  }>;
};

type KryptaPayQuote = {
  from: MoneyCurrency;
  to: MoneyCurrency;
  fromAmount: string;
  toAmount: string;
  midRate: string;
  appliedRate: string;
  spreadBps: number;
  expiresAt: string;
};

type KryptaPayConversion = {
  id: string;
  reference: string;
  status: string;
  fromCurrency: MoneyCurrency;
  toCurrency: MoneyCurrency;
  fromAmount: string;
  toAmount: string;
  midRate: string;
  appliedRate: string;
  spreadBps: number;
  settledAt?: string | null;
};

export function unwrapKryptaPayData<T>(envelope: KryptaPayEnvelope<T>): T {
  if (!envelope.ok || !envelope.data) {
    throw new Error(envelope.error?.message ?? "KryptaPay returned an unsuccessful response");
  }

  return envelope.data;
}

export function mapKryptaPayPayin(
  data: KryptaPayPayin,
  trace: ProviderTrace
): PayinResult {
  return withoutUndefined({
    reference: data.reference,
    status: mapTransactionStatus(data.status),
    amount: data.amount,
    currency: data.currency,
    network: data.network ?? undefined,
    checkoutUrl: data.checkoutUrl ?? undefined,
    checkoutToken: data.checkoutToken ?? undefined,
    expiresInSec: data.expiresInSec,
    expiresAt: data.expiresAt ?? undefined,
    initiatedAt: data.initiatedAt,
    settledAt: data.settledAt ?? undefined,
    trace: {
      ...trace,
      providerTransactionId: trace.providerTransactionId ?? data.reference,
      providerReference: trace.providerReference ?? data.reference
    }
  });
}

export function mapKryptaPayPayout(
  data: KryptaPayPayout,
  trace: ProviderTrace
): PayoutResult {
  return withoutUndefined({
    id: data.id,
    reference: data.reference,
    status: mapTransactionStatus(data.status),
    amount: data.amount,
    currency: data.currency,
    fee: data.fee,
    network: data.network ?? undefined,
    description: data.description ?? undefined,
    recipient: withoutUndefined({
      msisdn: data.recipient?.msisdn ?? undefined,
      iban: data.recipient?.iban ?? undefined,
      address: data.recipient?.address ?? undefined,
      chain: data.recipient?.chain ?? undefined
    }),
    failureReason: data.failureReason ?? undefined,
    initiatedAt: data.initiatedAt,
    settledAt: data.settledAt ?? undefined,
    failedAt: data.failedAt ?? undefined,
    approvedAt: data.approvedAt ?? undefined,
    autoExecuted: data.autoExecuted,
    frozen: data.frozen,
    trace: {
      ...trace,
      providerTransactionId: trace.providerTransactionId ?? data.id,
      providerReference: trace.providerReference ?? data.providerRef ?? data.reference
    }
  });
}

export function mapKryptaPayPayoutList(
  data: KryptaPayPayoutList,
  trace: Omit<ProviderTrace, "providerTransactionId" | "providerReference">
): ListPayoutsResult {
  return withoutUndefined({
    items: data.items.map((item) =>
      mapKryptaPayPayout(item, {
        ...trace,
        providerTransactionId: item.id,
        providerReference: item.providerRef ?? item.reference
      })
    ),
    nextCursor: data.nextCursor ?? undefined,
    trace
  });
}

export function mapKryptaPayFxRates(
  data: KryptaPayFxRates,
  trace: Omit<ProviderTrace, "providerTransactionId" | "providerReference">
): FxRatesResult {
  return {
    spreadBps: data.spreadBps,
    generatedAt: data.generatedAt,
    rates: data.rates.map((rate) => ({
      from: rate.from,
      to: rate.to,
      midRate: rate.mid,
      buyRate: rate.buy,
      sellRate: rate.sell,
      source: rate.source,
      validFrom: rate.validFrom
    })),
    trace
  };
}

export function mapKryptaPayQuote(
  data: KryptaPayQuote,
  trace: Omit<ProviderTrace, "providerTransactionId" | "providerReference">
): ConversionQuoteResult {
  return {
    from: data.from,
    to: data.to,
    fromAmount: data.fromAmount,
    toAmount: data.toAmount,
    midRate: data.midRate,
    appliedRate: data.appliedRate,
    spreadBps: data.spreadBps,
    expiresAt: data.expiresAt,
    trace
  };
}

export function mapKryptaPayConversion(
  data: KryptaPayConversion,
  trace: ProviderTrace
): ConversionResult {
  return withoutUndefined({
    id: data.id,
    reference: data.reference,
    status: data.status,
    from: data.fromCurrency,
    to: data.toCurrency,
    fromAmount: data.fromAmount,
    toAmount: data.toAmount,
    midRate: data.midRate,
    appliedRate: data.appliedRate,
    spreadBps: data.spreadBps,
    settledAt: data.settledAt ?? undefined,
    trace: {
      ...trace,
      providerTransactionId: trace.providerTransactionId ?? data.id,
      providerReference: trace.providerReference ?? data.reference
    }
  });
}

export function createMerchantReference(prefix: string) {
  return `rp_${prefix}_${Date.now().toString(36)}_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

export function mapTransactionStatus(status: string): ProviderTransactionStatus {
  switch (status) {
    case "PENDING":
      return "pending";
    case "PROCESSING":
      return "processing";
    case "COMPLETED":
      return "completed";
    case "FAILED":
      return "failed";
    case "CANCELLED":
      return "cancelled";
    case "REFUNDED":
      return "refunded";
    default:
      return "unknown";
  }
}

export function resolveMerchantReference(prefix: string, context?: ProviderOperationContext) {
  return context?.merchantReference ?? createMerchantReference(prefix);
}

function withoutUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}
