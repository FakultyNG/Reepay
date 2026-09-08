import { HttpService } from "@nestjs/axios";
import { Inject, Injectable } from "@nestjs/common";
import { AxiosRequestConfig, AxiosResponse } from "axios";
import { lastValueFrom } from "rxjs";
import { randomUUID } from "node:crypto";
import { withProviderRetry } from "../../common/http/provider-retry";
import { KryptaPayConfig } from "./kryptapay.config";
import { normalizeKryptaPayError, readHeader } from "./kryptapay.errors";
import type {
  CreateConversionQuoteRequest,
  ConversionQuoteResult,
  ConversionResult,
  ExecuteConversionRequest,
  FxRatesResult,
  KryptaPayFxProvider
} from "./interfaces/kryptapay-fx-provider.interface";
import type {
  CreatePayinRequest,
  KryptaPayPaymentProvider,
  PayinResult
} from "./interfaces/kryptapay-payment-provider.interface";
import type {
  CreatePayoutRequest,
  KryptaPayPayoutProvider,
  ListPayoutsRequest,
  ListPayoutsResult,
  PayoutResult
} from "./interfaces/kryptapay-payout-provider.interface";
import {
  mapKryptaPayConversion,
  mapKryptaPayFxRates,
  mapKryptaPayPayin,
  mapKryptaPayPayout,
  mapKryptaPayPayoutList,
  mapKryptaPayQuote,
  resolveMerchantReference,
  unwrapKryptaPayData
} from "./kryptapay.mapper";
import type { ProviderOperationContext, ProviderTrace } from "../types";

@Injectable()
export class KryptaPayClient implements KryptaPayPaymentProvider, KryptaPayPayoutProvider, KryptaPayFxProvider {
  constructor(
    @Inject(HttpService) private readonly http: HttpService,
    @Inject(KryptaPayConfig) private readonly config: KryptaPayConfig
  ) {}

  async createPayinCheckout(request: CreatePayinRequest, context?: ProviderOperationContext): Promise<PayinResult> {
    const merchantReference = resolveMerchantReference("payin", context);
    const response = await this.request("post", "/v1/payins/checkout", request, {
      context: { ...context, merchantReference },
      idempotent: true
    });

    return mapKryptaPayPayin(unwrapKryptaPayData(response.data), this.trace(response, merchantReference));
  }

  async getPayinStatus(reference: string, context?: ProviderOperationContext): Promise<PayinResult> {
    const merchantReference = resolveMerchantReference("payin_status", context);
    const response = await this.request("get", `/v1/payins/${encodeURIComponent(reference)}`, undefined, {
      context: { ...context, merchantReference }
    });

    return mapKryptaPayPayin(unwrapKryptaPayData(response.data), this.trace(response, merchantReference));
  }

  async createPayout(request: CreatePayoutRequest, context?: ProviderOperationContext): Promise<PayoutResult> {
    const merchantReference = resolveMerchantReference("payout", context);
    const response = await this.request("post", "/v1/payouts/", request, {
      context: { ...context, merchantReference },
      idempotent: true
    });

    return mapKryptaPayPayout(unwrapKryptaPayData(response.data), this.trace(response, merchantReference));
  }

  async getPayout(idOrReference: string, context?: ProviderOperationContext): Promise<PayoutResult> {
    const merchantReference = resolveMerchantReference("payout_status", context);
    const response = await this.request("get", `/v1/payouts/${encodeURIComponent(idOrReference)}`, undefined, {
      context: { ...context, merchantReference }
    });

    return mapKryptaPayPayout(unwrapKryptaPayData(response.data), this.trace(response, merchantReference));
  }

  async listPayouts(request: ListPayoutsRequest = {}, context?: ProviderOperationContext): Promise<ListPayoutsResult> {
    const merchantReference = resolveMerchantReference("payouts", context);
    const response = await this.request("get", "/v1/payouts/", undefined, {
      context: { ...context, merchantReference },
      params: request
    });

    return mapKryptaPayPayoutList(unwrapKryptaPayData(response.data), this.trace(response, merchantReference));
  }

  async approvePayout(id: string, context?: ProviderOperationContext): Promise<PayoutResult> {
    const merchantReference = resolveMerchantReference("payout_approve", context);
    const response = await this.request("post", `/v1/payouts/${encodeURIComponent(id)}/approve`, undefined, {
      context: { ...context, merchantReference }
    });

    return mapKryptaPayPayout(unwrapKryptaPayData(response.data), this.trace(response, merchantReference));
  }

  async rejectPayout(id: string, reason?: string, context?: ProviderOperationContext): Promise<PayoutResult> {
    const merchantReference = resolveMerchantReference("payout_reject", context);
    const response = await this.request(
      "post",
      `/v1/payouts/${encodeURIComponent(id)}/reject`,
      reason ? { reason } : {},
      {
        context: { ...context, merchantReference }
      }
    );

    return mapKryptaPayPayout(unwrapKryptaPayData(response.data), this.trace(response, merchantReference));
  }

  async cancelPayout(id: string, context?: ProviderOperationContext): Promise<PayoutResult> {
    const merchantReference = resolveMerchantReference("payout_cancel", context);
    const response = await this.request("post", `/v1/payouts/${encodeURIComponent(id)}/cancel`, undefined, {
      context: { ...context, merchantReference }
    });

    return mapKryptaPayPayout(unwrapKryptaPayData(response.data), this.trace(response, merchantReference));
  }

  async getCurrentFxRates(context?: ProviderOperationContext): Promise<FxRatesResult> {
    const merchantReference = resolveMerchantReference("fx_rates", context);
    const response = await this.request("get", "/v1/fx/rates", undefined, {
      context: { ...context, merchantReference }
    });

    return mapKryptaPayFxRates(unwrapKryptaPayData(response.data), this.trace(response, merchantReference));
  }

  async createIndicativeConversionQuote(
    request: CreateConversionQuoteRequest,
    context?: ProviderOperationContext
  ): Promise<ConversionQuoteResult> {
    const merchantReference = resolveMerchantReference("fx_quote", context);
    const response = await this.request("post", "/v1/fx/quote", request, {
      context: { ...context, merchantReference }
    });

    return mapKryptaPayQuote(unwrapKryptaPayData(response.data), this.trace(response, merchantReference));
  }

  async executeConversion(request: ExecuteConversionRequest, context?: ProviderOperationContext): Promise<ConversionResult> {
    const merchantReference = resolveMerchantReference("fx_convert", context);
    const response = await this.request(
      "post",
      "/v1/fx/convert",
      {
        ...request,
        reference: merchantReference
      },
      {
        context: { ...context, merchantReference },
        idempotent: true
      }
    );

    return mapKryptaPayConversion(unwrapKryptaPayData(response.data), this.trace(response, merchantReference));
  }

  private async request(
    method: "get" | "post",
    path: string,
    data?: unknown,
    options: {
      context: ProviderOperationContext & { merchantReference: string };
      idempotent?: boolean;
      params?: Record<string, unknown>;
    } = { context: { merchantReference: resolveMerchantReference("request") } }
  ): Promise<AxiosResponse> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.config.apiKey}`,
      "Content-Type": "application/json",
      "X-Request-Id": options.context.requestId ?? randomUUID()
    };

    if (options.idempotent) {
      headers["Idempotency-Key"] = options.context.idempotencyKey ?? randomUUID();
    }

    const requestConfig: AxiosRequestConfig = {
      baseURL: this.config.baseUrl,
      url: path,
      method,
      headers,
      params: cleanQuery(options.params)
    };

    if (data !== undefined) {
      requestConfig.data = data;
    }

    try {
      const execute = () => lastValueFrom(this.http.request(requestConfig));
      return await (method === "get" || options.idempotent ? withProviderRetry(execute) : execute());
    } catch (error) {
      throw normalizeKryptaPayError(error);
    }
  }

  private trace(response: AxiosResponse, merchantReference: string): ProviderTrace {
    return {
      provider: "kryptapay",
      providerRequestId: readHeader(response.headers, "x-request-id"),
      merchantReference
    };
  }
}

function cleanQuery(params?: Record<string, unknown>) {
  if (!params) {
    return undefined;
  }

  return Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined && value !== null));
}
