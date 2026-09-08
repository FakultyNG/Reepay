import { HttpService } from "@nestjs/axios";
import { Inject, Injectable, ServiceUnavailableException } from "@nestjs/common";
import { AxiosRequestConfig, AxiosResponse } from "axios";
import { randomUUID } from "node:crypto";
import { lastValueFrom } from "rxjs";
import { withProviderRetry } from "../../common/http/provider-retry";
import type { ProviderOperationContext } from "../types";
import { normalizeWiseError } from "./wise.errors";
import { WiseConfig } from "./wise.config";

export type WiseRecipientResult = {
  id: string;
  name?: string | undefined;
};

export type WiseQuoteResult = {
  id: string;
  sourceAmount: string;
  targetAmount: string;
  fee: string;
  rate: string;
  expiresAt: string;
};

export type WiseTransferResult = {
  id: string;
  status: string;
  reference?: string | undefined;
};

@Injectable()
export class WiseClient {
  constructor(
    @Inject(HttpService) private readonly http: HttpService,
    @Inject(WiseConfig) private readonly config: WiseConfig
  ) {}

  async createIbanRecipient(
    request: { iban: string; accountHolderName: string },
    context?: ProviderOperationContext
  ): Promise<WiseRecipientResult> {
    this.assertConfigured();
    const response = await this.request("post", "/v1/accounts", {
      currency: "EUR",
      type: "iban",
      profile: this.config.profileId,
      accountHolderName: request.accountHolderName,
      ownedByCustomer: false,
      details: {
        iban: request.iban
      }
    }, context);

    return withoutUndefined({
      id: String(readField(response.data, "id")),
      name: readNestedName(response.data)
    });
  }

  async createWiseTagContact(
    request: { wiseTag: string },
    context?: ProviderOperationContext
  ): Promise<WiseRecipientResult> {
    this.assertConfigured();
    const response = await this.request(
      "post",
      `/2026Q3/profiles/${this.config.profileId}/contacts`,
      {
        identifier: request.wiseTag,
        targetCurrency: "EUR"
      },
      context,
      { isDirectIdentifierCreation: true }
    );

    return withoutUndefined({
      id: String(readField(response.data, "contactId")),
      name: readString(response.data, "name")
    });
  }

  async createEurBalancePayoutQuote(
    request: { amount: string; contactId?: string; targetAccount?: string },
    context?: ProviderOperationContext
  ): Promise<WiseQuoteResult> {
    this.assertConfigured();
    const response = await this.request("post", "/v1/quotes", {
      profile: this.config.profileId,
      source: "EUR",
      target: "EUR",
      targetAmount: request.amount,
      rateType: "FIXED",
      type: "BALANCE_PAYOUT",
      ...(request.contactId ? { contactId: request.contactId } : {}),
      ...(request.targetAccount ? { targetAccount: Number(request.targetAccount) } : {})
    }, context);

    const expiresAt = readString(response.data, "expirationTime") ?? readString(response.data, "expiresAt");

    return {
      id: String(readField(response.data, "id")),
      sourceAmount: String(readField(response.data, "sourceAmount")),
      targetAmount: String(readField(response.data, "targetAmount")),
      fee: String(readField(response.data, "fee")),
      rate: String(readField(response.data, "rate")),
      expiresAt: expiresAt ?? new Date(Date.now() + 15 * 60_000).toISOString()
    };
  }

  async createTransfer(
    request: { targetAccount: string; quoteId: string; customerTransactionId: string; reference: string },
    context?: ProviderOperationContext
  ): Promise<WiseTransferResult> {
    this.assertConfigured();
    const response = await this.request("post", "/v1/transfers", {
      targetAccount: Number(request.targetAccount),
      quoteUuid: request.quoteId,
      customerTransactionId: request.customerTransactionId,
      details: {
        reference: request.reference
      }
    }, context);

    return mapTransfer(response.data);
  }

  async fundTransfer(transferId: string, context?: ProviderOperationContext): Promise<WiseTransferResult> {
    this.assertConfigured();
    const response = await this.request(
      "post",
      `/v3/profiles/${this.config.profileId}/transfers/${encodeURIComponent(transferId)}/payments`,
      {
        type: "BALANCE"
      },
      context
    );

    return mapTransfer(response.data);
  }

  async getTransfer(transferId: string, context?: ProviderOperationContext): Promise<WiseTransferResult> {
    this.assertConfigured();
    const response = await this.request("get", `/v1/transfers/${encodeURIComponent(transferId)}`, undefined, context);
    return mapTransfer(response.data);
  }

  private assertConfigured() {
    if (!this.config.apiToken || !this.config.profileId) {
      throw new ServiceUnavailableException("Wise provider is not configured");
    }
  }

  private async request(
    method: "get" | "post",
    path: string,
    data?: unknown,
    context?: ProviderOperationContext,
    params?: Record<string, unknown>
  ): Promise<AxiosResponse> {
    const requestConfig: AxiosRequestConfig = {
      baseURL: this.config.baseUrl,
      url: path,
      method,
      data,
      params,
      headers: {
        Authorization: `Bearer ${this.config.apiToken}`,
        "Content-Type": "application/json",
        "X-External-Correlation-Id": context?.requestId ?? randomUUID()
      }
    };

    try {
      const execute = () => lastValueFrom(this.http.request(requestConfig));
      return await (method === "get" ? withProviderRetry(execute) : execute());
    } catch (error) {
      throw normalizeWiseError(error);
    }
  }
}

function mapTransfer(data: unknown): WiseTransferResult {
  return withoutUndefined({
    id: String(readField(data, "id")),
    status: String(readField(data, "status")),
    reference: readString(data, "reference")
  });
}

function readField(data: unknown, key: string) {
  if (typeof data !== "object" || data === null || !(key in data)) {
    throw new ServiceUnavailableException(`Wise response missing ${key}`);
  }

  return (data as Record<string, unknown>)[key];
}

function readString(data: unknown, key: string) {
  if (typeof data !== "object" || data === null || !(key in data)) {
    return undefined;
  }

  const value = (data as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

function readNestedName(data: unknown) {
  if (typeof data !== "object" || data === null || !("name" in data)) {
    return undefined;
  }

  const name = (data as Record<string, unknown>).name;
  if (typeof name === "string") {
    return name;
  }

  if (typeof name === "object" && name !== null && "fullName" in name) {
    const fullName = (name as Record<string, unknown>).fullName;
    return typeof fullName === "string" ? fullName : undefined;
  }

  return undefined;
}

function withoutUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}
