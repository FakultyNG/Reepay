import { BadGatewayException, HttpException, ServiceUnavailableException } from "@nestjs/common";
import type { AxiosError } from "axios";

export type ReepayProviderErrorBody = {
  code: string;
  message: string;
  provider: "kryptapay";
  providerRequestId?: string | undefined;
};

export class ReepayProviderException extends HttpException {
  constructor(statusCode: number, body: ReepayProviderErrorBody) {
    super(body, statusCode);
  }
}

export function normalizeKryptaPayError(error: unknown): Error {
  if (!isAxiosError(error)) {
    return error instanceof Error ? error : new Error("KryptaPay request failed");
  }

  const providerRequestId = readHeader(error.response?.headers, "x-request-id");
  const statusCode = error.response?.status;
  const providerError = readProviderError(error.response?.data);

  if (!statusCode) {
    return new ServiceUnavailableException({
      code: "provider_unavailable",
      message: "Payment provider is unavailable",
      provider: "kryptapay",
      providerRequestId
    });
  }

  if (statusCode >= 400 && statusCode < 500) {
    return new ReepayProviderException(statusCode, {
      code: providerError.code,
      message: providerError.message,
      provider: "kryptapay",
      providerRequestId
    });
  }

  return new BadGatewayException({
    code: "provider_error",
    message: "Payment provider request failed",
    provider: "kryptapay",
    providerRequestId
  });
}

function isAxiosError(error: unknown): error is AxiosError {
  return Boolean(error && typeof error === "object" && "isAxiosError" in error);
}

function readProviderError(data: unknown) {
  if (typeof data === "object" && data !== null && "error" in data) {
    const error = (data as { error?: { code?: unknown; message?: unknown } }).error;
    return {
      code: typeof error?.code === "string" ? error.code : "provider_rejected_request",
      message: typeof error?.message === "string" ? error.message : "Payment provider rejected the request"
    };
  }

  return {
    code: "provider_rejected_request",
    message: "Payment provider rejected the request"
  };
}

export function readHeader(headers: unknown, name: string): string | undefined {
  if (!headers || typeof headers !== "object") {
    return undefined;
  }

  const value = (headers as Record<string, unknown>)[name] ?? (headers as Record<string, unknown>)[name.toLowerCase()];
  return typeof value === "string" ? value : undefined;
}
