import type {
  MoneyCurrency,
  PaymentNetwork,
  ProviderOperationContext,
  ProviderTrace,
  ProviderTransactionStatus
} from "../../types";

export type PayoutRecipient = {
  msisdn?: string | undefined;
  iban?: string | undefined;
  address?: string | undefined;
  chain?: PaymentNetwork | undefined;
  fullName?: string | undefined;
  customerId?: string | undefined;
  bankName?: string | undefined;
  bankId?: string | number | undefined;
  accountNumber?: string | undefined;
};

export type CreatePayoutRequest = {
  amount: string;
  currency: MoneyCurrency;
  network: PaymentNetwork;
  recipient: PayoutRecipient;
  description?: string | undefined;
  category?: string | undefined;
  counterpartyId?: string | undefined;
  paymentPin?: string | undefined;
  totp?: string | undefined;
};

export type PayoutResult = {
  id: string;
  reference: string;
  status: ProviderTransactionStatus;
  amount: string;
  currency: MoneyCurrency;
  fee?: string | undefined;
  network?: PaymentNetwork | undefined;
  description?: string | undefined;
  recipient: {
    msisdn?: string | undefined;
    iban?: string | undefined;
    address?: string | undefined;
    chain?: PaymentNetwork | undefined;
  };
  failureReason?: string | undefined;
  initiatedAt?: string | undefined;
  settledAt?: string | undefined;
  failedAt?: string | undefined;
  approvedAt?: string | undefined;
  autoExecuted?: boolean | undefined;
  frozen?: boolean | undefined;
  trace: ProviderTrace;
};

export type ListPayoutsRequest = {
  limit?: number | undefined;
  cursor?: string | undefined;
};

export type ListPayoutsResult = {
  items: PayoutResult[];
  nextCursor?: string | undefined;
  trace: Omit<ProviderTrace, "providerTransactionId" | "providerReference">;
};

export interface KryptaPayPayoutProvider {
  createPayout(request: CreatePayoutRequest, context?: ProviderOperationContext): Promise<PayoutResult>;
  getPayout(idOrReference: string, context?: ProviderOperationContext): Promise<PayoutResult>;
  listPayouts(request?: ListPayoutsRequest, context?: ProviderOperationContext): Promise<ListPayoutsResult>;
  approvePayout(id: string, context?: ProviderOperationContext): Promise<PayoutResult>;
  rejectPayout(id: string, reason?: string, context?: ProviderOperationContext): Promise<PayoutResult>;
  cancelPayout(id: string, context?: ProviderOperationContext): Promise<PayoutResult>;
}
