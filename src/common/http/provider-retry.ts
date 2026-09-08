import type { AxiosError } from "axios";

export async function withProviderRetry<T>(
  operation: () => Promise<T>,
  options: { attempts?: number; baseDelayMs?: number } = {}
): Promise<T> {
  const attempts = options.attempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 250;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !isRetryableProviderError(error)) {
        throw error;
      }

      await delay(baseDelayMs * 2 ** (attempt - 1));
    }
  }

  throw lastError;
}

function isRetryableProviderError(error: unknown) {
  if (!isAxiosError(error)) {
    return false;
  }

  if (!error.response) {
    return true;
  }

  const status = error.response.status;
  return status === 408 || status === 429 || status >= 500;
}

function isAxiosError(error: unknown): error is AxiosError {
  return Boolean(error && typeof error === "object" && "isAxiosError" in error);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
