import type { MoneyCurrency, ProviderOperationContext, ProviderTrace } from "../../types";

export type FxRate = {
  from: MoneyCurrency;
  to: MoneyCurrency;
  midRate: string;
  buyRate: string;
  sellRate: string;
  source: string;
  validFrom: string;
};

export type FxRatesResult = {
  spreadBps: number;
  generatedAt: string;
  rates: FxRate[];
  trace: Omit<ProviderTrace, "providerTransactionId" | "providerReference">;
};

export type CreateConversionQuoteRequest = {
  from: MoneyCurrency;
  to: MoneyCurrency;
  amount: string;
  side?: "debit_from" | "credit_to" | undefined;
};

export type ConversionQuoteResult = {
  from: MoneyCurrency;
  to: MoneyCurrency;
  fromAmount: string;
  toAmount: string;
  midRate: string;
  appliedRate: string;
  spreadBps: number;
  expiresAt: string;
  trace: Omit<ProviderTrace, "providerTransactionId" | "providerReference">;
};

export type ExecuteConversionRequest = {
  from: MoneyCurrency;
  to: MoneyCurrency;
  amount: string;
};

export type ConversionResult = {
  id: string;
  reference: string;
  status: string;
  from: MoneyCurrency;
  to: MoneyCurrency;
  fromAmount: string;
  toAmount: string;
  midRate: string;
  appliedRate: string;
  spreadBps: number;
  settledAt?: string | undefined;
  trace: ProviderTrace;
};

export interface KryptaPayFxProvider {
  getCurrentFxRates(context?: ProviderOperationContext): Promise<FxRatesResult>;
  createIndicativeConversionQuote(
    request: CreateConversionQuoteRequest,
    context?: ProviderOperationContext
  ): Promise<ConversionQuoteResult>;
  executeConversion(request: ExecuteConversionRequest, context?: ProviderOperationContext): Promise<ConversionResult>;
}
