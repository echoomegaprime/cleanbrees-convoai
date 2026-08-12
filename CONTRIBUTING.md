# Contributing

## Setup

```bash
npm install
npm run dev
```

## Before opening a PR

```bash
npm run typecheck
npm test
```

Both must pass.

## Style

- TypeScript + Hono. Keep it that way.
- Any change to `verifyTwilioSignature`, `verifyConvoAISecret`, `requireAdminAuth`, or
  `timingSafeEqual` must ship with a test in `tests/security.test.ts` that fails against the old
  behavior and passes against the new one — these functions are the entire security boundary of
  this Worker.
- `/twilio/voice`, `/twilio/status`, and `/twilio/forward` must always call
  `verifyTwilioSignature()` before acting on the request body.
- `/convoai/tools` must always call `verifyConvoAISecret()` before executing a tool.
- `/setup/agent`, `/setup/twilio`, and `/setup/db` must always call `requireAdminAuth()` first.
- Test any auth change end-to-end through the actual route (`app.fetch(...)`), not only as a
  pure-function unit test — a route can call the right function and still forget to check its
  return value. This repo's own test suite caught exactly that gap once already (see git log).
- Never hardcode a secret. `ELEVENLABS_API_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
  `GOOGLE_MAPS_API_KEY`, `ADMIN_API_KEY`, and `CONVOAI_WEBHOOK_SECRET` are set with `wrangler
  secret put` and read only from `env`.

## Reporting security issues

See [SECURITY.md](SECURITY.md) — do not open a public issue for undisclosed vulnerabilities.
