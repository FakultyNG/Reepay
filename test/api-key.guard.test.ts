import type { ExecutionContext } from "@nestjs/common";
import { UnauthorizedException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { ApiKeyGuard } from "../src/auth/api-key.guard";
import type { AppConfigService } from "../src/config/app-config.service";

function context(headers: Record<string, string | undefined>) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        header: (name: string) => headers[name.toLowerCase()]
      })
    })
  } as ExecutionContext;
}

describe("ApiKeyGuard", () => {
  const guard = new ApiKeyGuard({
    apiKey: "server-secret",
    allowedApplicationIds: ["sangapay-backend"]
  } as AppConfigService);

  it("accepts SangaPay backend server credentials with application identity", () => {
    expect(
      guard.canActivate(
        context({
          "x-reepay-api-key": "server-secret",
          "x-reepay-application-id": "sangapay-backend"
        })
      )
    ).toBe(true);
  });

  it("rejects requests missing valid application identity", () => {
    expect(() =>
      guard.canActivate(
        context({
          "x-reepay-api-key": "server-secret"
        })
      )
    ).toThrow(UnauthorizedException);
  });
});
