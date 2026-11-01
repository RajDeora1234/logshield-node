// logshield-node/index.js
// SDK: Automatic error monitoring and real-time Slack alerts for Node.js
// v2.0.0 — Fully serverless. Posts directly to Slack. No backend required.

const FETCH_TIMEOUT_MS = 10000; // 10 seconds per attempt
const MAX_RETRIES = 3;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Truncate long strings so Slack doesn't reject the payload */
function truncate(str, maxLen = 2900) {
  if (!str) return 'N/A';
  return str.length > maxLen ? str.substring(0, maxLen) + '\n...[truncated]' : str;
}

/**
 * Sleep for `ms` milliseconds — used for exponential backoff between retries.
 * @param {number} ms
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Build a rich Slack Block Kit payload from a log data object.
 * Format is preserved exactly as the LogShield worker processor.
 */
function buildSlackPayload({ environment, level, message, stack, timestamp, meta }) {
  const alertEmoji = level === 'critical' ? '🔴' : '🟠';
  const envLabel   = (environment || 'unknown').toUpperCase();
  const levelLabel = (level || 'error').toUpperCase();

  const metaString =
    meta && Object.keys(meta).length > 0
      ? JSON.stringify(meta, null, 2)
      : 'None';

  return {
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `${alertEmoji} LogShield Alert`,
          emoji: true,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Error:* ${truncate(message, 150)}`,
        },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Environment:*\n\`${envLabel}\`` },
          { type: 'mrkdwn', text: `*Severity:*\n\`${levelLabel}\`` },
        ],
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Timestamp:*\n${timestamp || new Date().toISOString()}`,
          },
        ],
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Metadata Context:*\n\`\`\`${truncate(metaString, 500)}\`\`\``,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Stack Trace:*\n\`\`\`${truncate(stack, 2500)}\`\`\``,
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `_Powered by LogShield Monitoring Engine_`,
          },
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// LogShield SDK Class
// ---------------------------------------------------------------------------

class LogShield {
  constructor() {
    this.slackWebhookUrl = null;
    this.environment     = process.env.NODE_ENV || 'development';
    this._initialized    = false;
  }

  /**
   * Initialize LogShield. Must be called once at app startup.
   * @param {{ slackWebhookUrl: string, environment?: string }} config
   */
  init(config) {
    if (!config || !config.slackWebhookUrl) {
      console.error(
        '[LogShield] Initialization Error: Missing slackWebhookUrl. Alerts will NOT be sent.'
      );
      return this;
    }

    // Strip surrounding quotes from the webhook URL in case dotenv includes them
    // e.g. SLACK_URL="https://..." would result in '"https://..."' as the value
    this.slackWebhookUrl = config.slackWebhookUrl.replace(/^["']|["']$/g, '').trim();

    if (config.environment) {
      this.environment = config.environment;
    }

    if (this._initialized) {
      console.warn('[LogShield] init() was called more than once. Skipping duplicate listener registration.');
      return this;
    }
    this._initialized = true;

    // 1. Capture Synchronous Runtime Crashes
    // Use an async IIFE so the HTTP POST has time to complete before process.exit(1).
    process.on('uncaughtException', (error) => {
      console.log('[LogShield] Intercepted runtime crash. Dispatching alert...');
      (async () => {
        try {
          await this.sendAlert(error);
          console.log('[LogShield] Alert delivered. Shutting down process safely.');
        } catch (err) {
          console.error('[LogShield] Critical failure during crash reporting:', err.message);
        } finally {
          process.exit(1);
        }
      })();
    });

    // 2. Capture Asynchronous Promise Failures
    process.on('unhandledRejection', (reason) => {
      console.log('[LogShield] Intercepted unhandled promise rejection. Dispatching alert...');
      const error = reason instanceof Error ? reason : new Error(String(reason));
      this.sendAlert(error).catch((err) => {
        console.error('[LogShield] Failed to send unhandledRejection alert:', err.message);
      });
    });

    console.log('[LogShield] Active monitoring running successfully. Webhook configured ✅');
    return this;
  }

  /**
   * Express error-handling middleware (4-arg signature).
   * Register AFTER all routes: app.use(logshield.expressMiddleware())
   */
  expressMiddleware() {
    return async (error, req, res, next) => {
      console.log(`[LogShield] Intercepted Express route error on ${req.method} ${req.url}`);

      if (!this.slackWebhookUrl) {
        console.error('[LogShield] Cannot send alert: slackWebhookUrl not configured. Did you call init()?');
        return next(error);
      }

      try {
        await this.sendAlert(error, {
          route:  req.url,
          method: req.method,
          ip:     req.ip || req.connection?.remoteAddress || 'unknown',
        });
      } catch (err) {
        // Don't block the response if alert sending fails
        console.error('[LogShield] expressMiddleware: Failed to send alert:', err.message);
      }

      next(error);
    };
  }

  /**
   * Core alert sender. Builds the Slack Block Kit payload and POSTs it
   * directly to the configured Slack Incoming Webhook URL.
   * Retries up to MAX_RETRIES times with exponential backoff.
   *
   * @param {Error|string} error
   * @param {object}       metadata  Optional context (route, method, ip, etc.)
   */
  async sendAlert(error, metadata = {}) {
    if (!this.slackWebhookUrl) {
      console.error('[LogShield] sendAlert skipped: no slackWebhookUrl configured.');
      return;
    }

    // Normalize error input — accept both Error objects and plain strings
    const errorObj = error instanceof Error ? error : new Error(String(error));

    const logData = {
      message:     errorObj.message || 'Unknown error',
      stack:       errorObj.stack   || 'No stack trace available',
      level:       'error',
      environment: this.environment,
      timestamp:   new Date().toISOString(),
      meta:        metadata,
    };

    const slackPayload = buildSlackPayload(logData);

    // -----------------------------------------------------------------------
    // Retry loop with exponential backoff
    // Attempt 1 → immediate
    // Attempt 2 → wait 1s
    // Attempt 3 → wait 2s
    // -----------------------------------------------------------------------
    let lastError;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 1) {
        const delayMs = 1000 * (attempt - 1); // 1s, 2s
        console.log(`[LogShield] Retrying in ${delayMs}ms... (attempt ${attempt}/${MAX_RETRIES})`);
        await sleep(delayMs);
      }

      const controller = new AbortController();
      const timeoutId  = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      try {
        console.log(`[LogShield] Sending alert to Slack... (attempt ${attempt}/${MAX_RETRIES})`);

        const response = await fetch(this.slackWebhookUrl, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(slackPayload),
          signal:  controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Slack API responded ${response.status}: ${errorText}`);
        }

        console.log('[LogShield] Alert dispatched successfully ✅');
        return; // Success — stop retrying

      } catch (err) {
        clearTimeout(timeoutId);
        lastError = err;

        if (err.name === 'AbortError') {
          console.error(`[LogShield] Attempt ${attempt} timed out after ${FETCH_TIMEOUT_MS}ms.`);
        } else {
          console.error(`[LogShield] Attempt ${attempt} failed: ${err.message}`);
        }
      }
    }

    // All retries exhausted
    console.error(`[LogShield] All ${MAX_RETRIES} attempts failed. Last error: ${lastError?.message}`);
    throw lastError;
  }
}

// CommonJS export — compatible with both require() and TS import with esModuleInterop
module.exports = LogShield;
module.exports.default = LogShield; // ESM interop: allows `import LogShield from '...'`