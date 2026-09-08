import type {
  MoneyCurrency,
  PaymentNetwork,
  ProviderOperationContext,
  ProviderTrace,
  ProviderTransactionStatus
} from "../../types";

export type CreatePayinRequest = {
  amount: string;
  currency: MoneyCurrency;
  network?: PaymentNetwork | undefined;
  customer: {
    fullName?: string | undefined;
    msisdn?: string | undefined;
    email?: string | undefined;
  };
  redirectUrl?: string | undefined;
  expiresInSec?: number | undefined;
};

export type PayinResult = {
  reference: string;
  status: ProviderTransactionStatus;
  amount: string;
  currency: MoneyCurrency;
  network?: PaymentNetwork | undefined;
  checkoutUrl?: string | undefined;
  checkoutToken?: string | undefined;
  expiresInSec?: number | undefined;
  expiresAt?: string | undefined;
  initiatedAt?: string | undefined;
  settledAt?: string | undefined;
  trace: ProviderTrace;
};

export interface KryptaPayPaymentProvider {
  createPayinCheckout(request: CreatePayinRequest, context?: ProviderOperationContext): Promise<PayinResult>;
  getPayinStatus(reference: string, context?: ProviderOperationContext): Promise<PayinResult>;
}
