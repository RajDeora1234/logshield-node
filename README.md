# @rajesh-deora/logshield-node

> **Automatic error monitoring and real-time Slack alerts for Node.js applications.**  
> Drop in 3 lines of code — get instant Slack notifications for every crash, unhandled rejection, and Express route error.  
> **No backend required. No Redis. No servers. Just your app and Slack.**

[![npm version](https://img.shields.io/npm/v/@rajesh-deora/logshield-node)](https://www.npmjs.com/package/@rajesh-deora/logshield-node)
[![license](https://img.shields.io/npm/l/@rajesh-deora/logshield-node)](./LICENSE)

---

## Table of Contents

- [How It Works](#how-it-works)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [API Reference](#api-reference)
  - [`init(config)`](#initconfig)
  - [`expressMiddleware()`](#expressmiddleware)
  - [`sendAlert(error, metadata?)`](#sendalerterror-metadata)
- [Usage Examples](#usage-examples)
  - [Basic Express App](#basic-express-app)
  - [Catching Unhandled Promise Rejections](#catching-unhandled-promise-rejections)
  - [Sending a Manual Alert](#sending-a-manual-alert)
- [What the Slack Alert Looks Like](#what-the-slack-alert-looks-like)
- [Environment Variables](#environment-variables)
- [Troubleshooting](#troubleshooting)
- [Changelog](#changelog)

---

## How It Works

```
Your App  ──(error)──▶  LogShield SDK  ──(HTTP POST)──▶  Slack Incoming Webhook
```

1. **SDK** intercepts errors in your app (crashes, promise rejections, Express errors).
2. **SDK** builds a rich Slack Block Kit message directly — no middleman.
3. **SDK** POSTs the alert straight to **your** Slack Incoming Webhook URL.
4. If the request fails, it **automatically retries up to 3 times** with exponential backoff.

> **v2.0.0 is fully serverless.** The SDK talks directly to Slack — there is no LogShield hosted API, no Redis, and no BullMQ worker involved anymore.

---

## Installation

```bash
npm install @rajesh-deora/logshield-node
```

> **Requires:** Node.js 18+ (uses native `fetch` and `AbortController`)

---

## Quick Start

**Step 1:** Create a [Slack Incoming Webhook](https://api.slack.com/messaging/webhooks) URL for your channel.

**Step 2:** Add LogShield to your app:

```js
// ESM (recommended)
import LogShield from '@rajesh-deora/logshield-node';

const logshield = new LogShield();

logshield.init({
  slackWebhookUrl: 'https://hooks.slack.com/services/YOUR/WEBHOOK/URL',
  environment: 'production'
});
```

That's it. LogShield now monitors your entire process. ✅

---

## Configuration

Always call `init()` **as early as possible** in your entry file — before any routes or other logic — so it can catch errors from the very start.

### With a `.env` file (recommended)

**.env**
```env
SLACK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
NODE_ENV=production
```

> ⚠️ **Do NOT wrap the webhook URL in quotes** in your `.env` file. Write it as a bare value:
> ```
> # ✅ Correct
> SLACK_URL=https://hooks.slack.com/services/T.../B.../xxx
>
> # ❌ Wrong — the literal quote characters will corrupt the URL
> SLACK_URL="https://hooks.slack.com/services/T.../B.../xxx"
> ```
> The SDK automatically strips surrounding quotes as a safety net, but it's best practice to avoid them.

**server.js**
```js
import 'dotenv/config'; // Must be FIRST
import LogShield from '@rajesh-deora/logshield-node';

const logshield = new LogShield();
logshield.init({
  slackWebhookUrl: process.env.SLACK_URL,
  environment: process.env.NODE_ENV
});
```

---

## API Reference

### `init(config)`

Activates LogShield monitoring. Must be called once, as early as possible in your app. Returns `this` for optional chaining.

| Option | Type | Required | Description |
|---|---|---|---|
| `slackWebhookUrl` | `string` | ✅ Yes | Your Slack Incoming Webhook URL. Alerts post directly to this URL. |
| `environment` | `string` | No | Label shown on alerts (e.g. `'production'`, `'staging'`). Defaults to `NODE_ENV` or `'development'`. |

```js
logshield.init({
  slackWebhookUrl: process.env.SLACK_URL,
  environment: 'production'
});
```

After `init()`, LogShield automatically listens for:
- `uncaughtException` — synchronous runtime crashes (process exits after alert is sent)
- `unhandledRejection` — async promise failures (process keeps running)

> **Safety:** Calling `init()` more than once is safe. Duplicate calls are detected and ignored — process event listeners will not be registered twice.

---

### `expressMiddleware()`

An Express 4-argument error-handling middleware. Register it **after all your routes**.

```js
app.use(logshield.expressMiddleware());
```

It captures errors forwarded via `next(error)` from your routes and sends a Slack alert that includes the route path, HTTP method, and client IP.

> ⚠️ **Important:** Your route handlers must pass `next` as the third argument and call `next(error)` to forward errors to this middleware.

```js
app.get('/api/checkout', (req, res, next) => {
  try {
    // your logic
  } catch (error) {
    next(error); // ← forwards to expressMiddleware
  }
});
```

> **Note:** If sending the Slack alert fails for any reason (e.g. network timeout after all retries), the middleware will log the error but still call `next(error)` so your own error response handler always runs and clients are never left hanging.

---

### `sendAlert(error, metadata?)`

Manually send a Slack alert for any error, with optional extra context.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `error` | `Error \| string` | ✅ Yes | An `Error` object or a plain string message to report |
| `metadata` | `object` | No | Any extra key-value context to include in the alert |

```js
try {
  await chargeCard(user);
} catch (error) {
  await logshield.sendAlert(error, {
    userId: user.id,
    amount: order.total,
    route: '/api/payments'
  });
}
```

> **Retries & Timeout:** `sendAlert` has a built-in **10-second timeout per attempt** and will **automatically retry up to 3 times** with exponential backoff (immediate → 1s → 2s). If all 3 attempts fail, the final error is thrown and a descriptive message is logged. This prevents your app from hanging indefinitely.

---

## Usage Examples

### Basic Express App

```js
import 'dotenv/config'; // ← Must be the very first line
import express from 'express';
import LogShield from '@rajesh-deora/logshield-node';

const app = express();
const logshield = new LogShield();

// ✅ Step 1: Init LogShield first, before any routes
logshield.init({
  slackWebhookUrl: process.env.SLACK_URL,
  environment: process.env.NODE_ENV || 'development'
});

app.use(express.json());

// Step 2: Your normal routes
app.get('/api/users', (req, res) => {
  res.json({ users: [] });
});

// Step 3: A route that might throw — always accept `next`
app.get('/api/orders/:id', async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) throw new Error('Order not found');
    res.json(order);
  } catch (error) {
    next(error); // ← forward to LogShield middleware
  }
});

// ✅ Step 4: Register LogShield middleware AFTER all routes
app.use(logshield.expressMiddleware());

// Step 5: Your own final error response handler (always after LogShield)
app.use((err, req, res, next) => {
  res.status(500).json({ error: err.message });
});

app.listen(3000, () => console.log('Server running on port 3000'));
```

---

### Catching Unhandled Promise Rejections

No extra setup needed — `init()` handles this automatically.

```js
// This will be caught and sent to Slack automatically
async function fetchData() {
  const data = await fetch('https://bad-url.invalid/api'); // rejects
}

fetchData(); // no await, no catch — LogShield catches it
```

---

### Sending a Manual Alert

Use `sendAlert()` anywhere in your codebase for business-critical paths:

```js
import LogShield from '@rajesh-deora/logshield-node';

const logshield = new LogShield();
logshield.init({ slackWebhookUrl: process.env.SLACK_URL });

async function processPayment(user, amount) {
  try {
    await stripe.charge({ amount, customer: user.stripeId });
  } catch (error) {
    // Send to Slack with extra business context
    await logshield.sendAlert(error, {
      userId: user.id,
      email: user.email,
      amount,
      action: 'stripe_charge'
    });
    throw error; // re-throw if needed
  }
}
```

---

## What the Slack Alert Looks Like

When an error is captured, your Slack channel receives a rich Block Kit message like this:

```
🟠 LogShield Alert
─────────────────────────────────
Error: Cannot read properties of undefined (reading 'price')

Environment:   `PRODUCTION`
Severity:      `ERROR`
Timestamp:     2026-06-21T08:00:00.000Z

Metadata Context:
{
  "route": "/api/checkout",
  "method": "GET",
  "ip": "::1"
}

Stack Trace:
ReferenceError: orderData is not defined
    at /app/server.js:25:22
    at Layer.handle [as handle_request] ...

─────────────────────────────────
Powered by LogShield Monitoring Engine
```

- 🔴 **Critical** errors use a red circle emoji.
- 🟠 **Error** (default) uses an orange circle emoji.
- Long stack traces and metadata are automatically truncated so Slack never rejects the payload.

---

## Environment Variables

| Variable | Description |
|---|---|
| `SLACK_URL` | Your Slack Incoming Webhook URL (no surrounding quotes) |
| `NODE_ENV` | Used as the environment label in alerts if not passed to `init()` |

---

## Troubleshooting

### ❌ Alert not arriving in Slack

1. **Check `init()` is called first** — before any routes or async code.
2. **Check `dotenv` is loaded** — add `import 'dotenv/config'` as the very first line of your entry file.
3. **Check for quotes in your `.env`** — ensure `SLACK_URL` is not wrapped in `"` or `'` quotes.
4. **Verify your Slack Webhook URL** — test it manually with curl:
   ```bash
   curl -X POST -H 'Content-type: application/json' \
     --data '{"text":"Test from LogShield"}' \
     YOUR_SLACK_WEBHOOK_URL
   ```
5. **Check your Express middleware order** — `expressMiddleware()` must be registered **after** all routes.
6. **Check that `next` is in route args** — route handlers must declare `(req, res, next)` and call `next(error)`.

---

### ❌ `[LogShield] Initialization Error: Missing slackWebhookUrl`

Your `SLACK_URL` env var is not being read. Make sure:
- Your `.env` file exists and has the correct key (`SLACK_URL`, not `SLACK_WEBHOOK_URL` or similar).
- `import 'dotenv/config'` is the **first** import in your file.
- The URL has **no surrounding quotes** in the `.env` file.

---

### ❌ `All 3 attempts failed`

The SDK retried posting to Slack 3 times and all failed. This can happen when:
- Your Slack Incoming Webhook URL is invalid or has been revoked — regenerate it in your Slack app settings.
- There is a network outage between your server and Slack's servers.
- The Slack API is temporarily unavailable.

**What to do:** Verify your webhook URL with the `curl` command above. If the URL is valid, the issue is likely transient — Slack's API will recover.

---

### ❌ `Attempt N timed out after 10000ms`

A single attempt to POST to Slack took longer than 10 seconds. This is unusual for Slack's API. Most commonly caused by:
- A misconfigured or extremely slow network on your server.
- A proxy or firewall blocking outbound HTTPS requests to `hooks.slack.com`.

**What to do:** Ensure your server can reach Slack's API: `curl https://slack.com`. If on a restricted network, allow outbound HTTPS traffic to `*.slack.com`.

---

### ❌ TypeErrors about `fetch` or `AbortController`

LogShield uses native `fetch` and `AbortController`. Ensure you are running **Node.js 18 or later**:
```bash
node --version
```

---

## Changelog

### v2.0.0 — Fully Serverless

> **Breaking change:** The `endpoint` option in `init()` has been removed. The SDK no longer routes alerts through a backend API — it posts directly to Slack.

- **Rewrite:** SDK is now fully serverless. Removed dependency on the hosted LogShield API, Redis, and BullMQ worker. Alerts go directly from your app to Slack.
- **Feature:** Built-in **retry with exponential backoff** — up to 3 attempts (immediate → 1s → 2s) before giving up. Replaces the BullMQ retry mechanism.
- **Feature:** Rich Slack **Block Kit** message format is now built inside the SDK — same format as before, no visual change in Slack.
- **Improvement:** Removed all cold-start concerns. Alerts fire instantly with no backend to wake up.
- **Improvement:** Zero infrastructure required — no servers to deploy or maintain.

---

### v1.0.11

- **Fix:** Added `AbortController` with a 10-second timeout on all `fetch` calls to prevent hanging on slow or cold API servers.
- **Fix:** `init()` now automatically strips surrounding `"` or `'` quote characters from `slackWebhookUrl`.
- **Fix:** `init()` now returns `this` for optional chaining.
- **Fix:** Added `_initialized` guard — calling `init()` multiple times no longer registers duplicate event listeners.
- **Fix:** `unhandledRejection` handler no longer uses `async/await` directly.
- **Fix:** `expressMiddleware()` wraps `sendAlert` in a try/catch so a network failure never blocks `next(error)`.
- **Fix:** `sendAlert()` now accepts both `Error` objects and plain strings.
- **Improvement:** Added `timestamp` to every outgoing alert payload.
- **Improvement:** Better error messages for `AbortError` vs general network failures.

### v1.0.10

- Initial stable release with Express middleware, uncaughtException, and unhandledRejection support.

---

## License

MIT © [Rajesh Deora](https://github.com/rajesh-deora)
