export type LogLevel = "info" | "warn" | "error";

export class Logger {
  constructor(private readonly context: Record<string, unknown> = {}) {}

  child(context: Record<string, unknown>): Logger {
    return new Logger({ ...this.context, ...context });
  }

  info(message: string, fields: Record<string, unknown> = {}): void {
    this.log("info", message, fields);
  }

  warn(message: string, fields: Record<string, unknown> = {}): void {
    this.log("warn", message, fields);
  }

  error(message: string, fields: Record<string, unknown> = {}): void {
    this.log("error", message, fields);
  }

  private log(level: LogLevel, message: string, fields: Record<string, unknown>): void {
    const payload = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...this.context,
      ...fields
    };

    const serialized = JSON.stringify(payload);
    if (level === "error") {
      console.error(serialized);
      return;
    }

    if (level === "warn") {
      console.warn(serialized);
      return;
    }

    console.log(serialized);
  }
}
