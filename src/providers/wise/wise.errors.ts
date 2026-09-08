import { ServiceUnavailableException } from "@nestjs/common";
import { AxiosError } from "axios";

export function normalizeWiseError(error: unknown): Error {
  if (error instanceof AxiosError) {
    const message = readWiseErrorMessage(error.response?.data) ?? error.message;
    return new ServiceUnavailableException(`Wise request failed: ${message}`);
  }

  return error instanceof Error ? error : new ServiceUnavailableException("Wise request failed");
}

function readWiseErrorMessage(data: unknown) {
  if (typeof data === "object" && data !== null && "message" in data && typeof data.message === "string") {
    return data.message;
  }

  if (typeof data === "object" && data !== null && "errors" in data && Array.isArray(data.errors)) {
    const first = data.errors[0] as { message?: unknown } | undefined;
    return typeof first?.message === "string" ? first.message : undefined;
  }

  return undefined;
}
