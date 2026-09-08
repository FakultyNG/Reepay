import { Inject, Injectable, NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { JsonLogger } from "../logging/json-logger";

@Injectable()
export class RequestLoggingMiddleware implements NestMiddleware {
  constructor(@Inject(JsonLogger) private readonly logger: JsonLogger) {}

  use(req: Request, res: Response, next: NextFunction) {
    const startedAt = Date.now();

    res.on("finish", () => {
      this.logger.log("request completed", {
        requestId: res.getHeader("x-request-id"),
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt
      });
    });

    next();
  }
}
