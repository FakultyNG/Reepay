import { ConsoleLogger, Injectable, type LogLevel } from "@nestjs/common";

@Injectable()
export class JsonLogger extends ConsoleLogger {
  log(message: unknown, context?: string | Record<string, unknown>) {
    this.write("log", message, context);
  }

  error(message: unknown, stack?: string, context?: string | Record<string, unknown>) {
    this.write("error", message, context, stack);
  }

  warn(message: unknown, context?: string | Record<string, unknown>) {
    this.write("warn", message, context);
  }

  debug(message: unknown, context?: string | Record<string, unknown>) {
    this.write("debug", message, context);
  }

  verbose(message: unknown, context?: string | Record<string, unknown>) {
    this.write("verbose", message, context);
  }

  private write(
    level: LogLevel,
    message: unknown,
    context?: string | Record<string, unknown>,
    stack?: string
  ) {
    const payload = {
      level,
      time: new Date().toISOString(),
      message,
      ...(typeof context === "string" ? { context } : context),
      ...(stack ? { stack } : {})
    };

    process.stdout.write(`${JSON.stringify(payload)}\n`);
  }
}
