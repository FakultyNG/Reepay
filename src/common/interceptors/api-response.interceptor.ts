import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor
} from "@nestjs/common";
import type { Request, Response } from "express";
import { map } from "rxjs";

@Injectable()
export class ApiResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    return next.handle().pipe(
      map((body: unknown) => {
        if (shouldBypassEnvelope(request)) {
          return body;
        }

        return {
          data: body,
          meta: {
            requestId: response.getHeader("x-request-id") ?? request.headers["x-request-id"],
            timestamp: new Date().toISOString()
          }
        };
      })
    );
  }
}

function shouldBypassEnvelope(request: Request) {
  const path = request.originalUrl.split("?")[0] ?? request.originalUrl;
  return (
    path === "/health" ||
    path === "/ready" ||
    path === "/api/v1/health" ||
    path === "/api/v1/ready" ||
    path.startsWith("/api/v1/webhooks/")
  );
}
