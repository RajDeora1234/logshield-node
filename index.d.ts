// Type Definitions for @rajesh-deora/logshield-node
// Project: https://github.com/rajesh-deora/logshield-node
// Author: Rajesh Deora

// ─── Configuration ───────────────────────────────────────────────────────────

/**
 * Configuration object passed to `LogShield.init()`.
 */
export interface LogShieldConfig {
  /**
   * Your Slack Incoming Webhook URL.
   * Get this from: https://api.slack.com/messaging/webhooks
   * @example "https://hooks.slack.com/services/T.../B.../..."
   */
  slackWebhookUrl: string;

  /**
   * The deployment environment label shown in Slack alerts.
   * Defaults to `process.env.NODE_ENV` or `"development"`.
   * @example "production" | "staging" | "development"
   */
  environment?: string;
}

// ─── Express Types (compatible with @types/express) ──────────────────────────

/**
 * Minimal Express-compatible request interface.
 * Compatible with `express.Request` if you have `@types/express` installed.
 */
export interface ExpressRequest {
  method: string;
  url: string;
  ip?: string;
  connection?: { remoteAddress?: string };
}

/**
 * Minimal Express-compatible response interface.
 */
export interface ExpressResponse {
  [key: string]: unknown;
}

/**
 * Minimal Express next-function interface.
 */
export type ExpressNextFunction = (error?: unknown) => void;

// ─── Main Class ──────────────────────────────────────────────────────────────

/**
 * LogShield — Automatic error monitoring and real-time Slack alerts.
 *
 * @example
 * ```typescript
 * import LogShield from '@rajesh-deora/logshield-node';
 *
 * const logshield = new LogShield();
 *
 * logshield.init({
 *   slackWebhookUrl: process.env.SLACK_WEBHOOK_URL!,
 *   environment: process.env.NODE_ENV,
 * });
 *
 * // Express middleware (register after all routes)
 * app.use(logshield.expressMiddleware());
 *
 * // Manual alert
 * await logshield.sendAlert(new Error('Something went wrong'), { userId: '123' });
 * ```
 */
declare class LogShield {
  /**
   * The configured Slack Incoming Webhook URL.
   * `null` until `init()` is called.
   */
  slackWebhookUrl: string | null;

  /**
   * The environment label used in Slack alerts.
   * Defaults to `process.env.NODE_ENV` or `"development"`.
   */
  environment: string;

  /**
   * Whether `init()` has already been called.
   * Subsequent calls to `init()` will be skipped to avoid duplicate listeners.
   */
  _initialized: boolean;

  /**
   * Initialize LogShield. Call this **once** at application startup,
   * before registering any routes or middleware.
   *
   * Registers `uncaughtException` and `unhandledRejection` listeners on
   * the Node.js process to capture crashes automatically.
   *
   * @param config - LogShield configuration object
   * @returns The LogShield instance (for chaining)
   *
   * @example
   * ```typescript
   * logshield.init({
   *   slackWebhookUrl: process.env.SLACK_WEBHOOK_URL!,
   *   environment: 'production',
   * });
   * ```
   */
  init(config: LogShieldConfig): this;

  /**
   * Returns an Express error-handling middleware function.
   *
   * Register this **after all routes** in your Express app.
   * It intercepts errors thrown in route handlers and sends a Slack alert
   * with request context (route, method, IP), then calls `next(error)`.
   *
   * @returns Express 4-argument error middleware
   *
   * @example
   * ```typescript
   * // ✅ Register AFTER all your routes
   * app.use(logshield.expressMiddleware());
   * ```
   */
  expressMiddleware(): (
    error: Error,
    req: import('express').Request,
    res: import('express').Response,
    next: import('express').NextFunction
  ) => Promise<void>;

  /**
   * Manually send a Slack alert for any error or custom event.
   *
   * Supports automatic retry with exponential backoff (up to 3 attempts).
   * Accepts both `Error` objects and plain strings.
   *
   * @param error    - The error to report (`Error` object or string message)
   * @param metadata - Optional key-value context to attach to the alert
   * @returns Promise that resolves when the alert is delivered
   * @throws If all retry attempts are exhausted
   *
   * @example
   * ```typescript
   * // With an Error object
   * await logshield.sendAlert(new Error('Payment failed'), {
   *   userId: 'u_123',
   *   orderId: 'ord_456',
   * });
   *
   * // With a plain string
   * await logshield.sendAlert('Database connection timeout', { db: 'primary' });
   * ```
   */
  sendAlert(error: Error | string, metadata?: Record<string, unknown>): Promise<void>;
}

export default LogShield;
