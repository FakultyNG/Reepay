import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus
} from "@nestjs/common";
import type { Request, Response } from "express";
import { JsonLogger } from "../logging/json-logger";

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: JsonLogger) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const errorResponse = exception instanceof HttpException ? exception.getResponse() : undefined;
    const requestId = response.getHeader("x-request-id") ?? request.headers["x-request-id"];

    this.logger.error("request failed", exception instanceof Error ? exception.stack : undefined, {
      requestId,
      method: request.method,
      path: request.originalUrl,
      statusCode: status
    });

    response.status(status).json({
      error: {
        code: normalizeErrorCode(errorResponse, status),
        message: normalizeErrorMessage(errorResponse, status),
        details: normalizeErrorDetails(errorResponse),
        requestId
      },
      meta: {
        timestamp: new Date().toISOString(),
        path: request.originalUrl
      }
    });
  }
}

function normalizeErrorMessage(errorResponse: unknown, status: number) {
  if (typeof errorResponse === "string") {
    return errorResponse;
  }

  if (typeof errorResponse === "object" && errorResponse !== null && "message" in errorResponse) {
    return (errorResponse as { message: unknown }).message;
  }

  return status === HttpStatus.INTERNAL_SERVER_ERROR ? "Internal server error" : "Request failed";
}

function normalizeErrorCode(errorResponse: unknown, status: number) {
  if (typeof errorResponse === "object" && errorResponse !== null && "error" in errorResponse) {
    const error = (errorResponse as { error: unknown }).error;
    if (typeof error === "string" && error.trim()) {
      return error.toUpperCase().replace(/\s+/g, "_");
    }
  }

  return `HTTP_${status}`;
}

function normalizeErrorDetails(errorResponse: unknown) {
  if (typeof errorResponse === "object" && errorResponse !== null && "message" in errorResponse) {
    const message = (errorResponse as { message: unknown }).message;
    if (Array.isArray(message)) {
      return message;
    }
  }

  return undefined;
}
