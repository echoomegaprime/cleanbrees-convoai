# Security Policy

## Reporting a Vulnerability

Report suspected vulnerabilities to **security@echo-op.com**. Do not open a public issue for
undisclosed security problems. We aim to acknowledge reports within 3 business days.

## 2026-08-12 incident: three unauthenticated webhook/admin surfaces

Discovered during GitHub Certified Consolidation.

**`POST /convoai/tools` had no authentication at all.** This route is meant to be called only by
ElevenLabs during a live phone call, but nothing verified that. Anyone who found the URL could
call it directly to:
- `send_sms` — send arbitrary SMS, with attacker-chosen recipient and message content, from the
  business's real Twilio number and real budget.
- `book_appointment` — write bogus bookings into the real, live scheduling database.
- `forward_to_owner` — trigger an SMS alert to the owner's personal phone with an
  attacker-controlled "reason" string.
- `get_directions` — an unauthenticated trigger for a metered Google Maps API call.

**`POST /twilio/voice`, `/twilio/status`, and `/twilio/forward` had no signature verification.**
Twilio signs every webhook request with `X-Twilio-Signature`; this code never checked it, so a
forged POST to `/twilio/forward` in particular could ring the owner's personal phone at will.

**`POST /setup/agent`, `/setup/twilio`, and `/setup/db` had no authentication.** `/setup/agent`
rewrites the live ConvoAI agent's entire configuration — system prompt, voice, tools — using the
real `ELEVENLABS_API_KEY`, meaning anyone could have silently changed what "Bree" says to real
callers. `/setup/twilio` can repoint any Twilio phone number in the account to this Worker's
webhook (bounded by needing a valid `phone_number_sid`, which is not itself secret). `/setup/db`
is idempotent (`CREATE TABLE IF NOT EXISTS`) and low severity on its own, but was gated with the
others for consistency and because a `/setup/*` prefix reads as "the admin routes" as a set.

**Fix**:
- `verifyTwilioSignature()` — recomputes Twilio's exact signature algorithm (`HMAC-SHA1(authToken,
  url + sorted(params).reduce((acc,[k,v]) => acc+k+v))`, base64), constant-time compared against
  `X-Twilio-Signature`, applied on all three Twilio routes before the request is acted on.
- `verifyConvoAISecret()` — checks a shared secret (`X-ConvoAI-Secret`) that `createOrUpdateAgent()`
  now embeds in the agent's own tool `request_headers` config, so ElevenLabs sends it back on
  every real tool call. `createOrUpdateAgent()` refuses to publish an agent config at all if
  `CONVOAI_WEBHOOK_SECRET` is unset, rather than silently publishing an unauthenticated one.
- `requireAdminAuth()` — the same `X-Echo-API-Key` + `timingSafeEqual` + fail-closed-503 pattern
  used elsewhere in this fleet, gating all three `/setup/*` routes.

`tests/security.test.ts` (20 tests) covers all three mechanisms and was **tamper-tested against
each of the three independently** — each auth check was removed in turn and confirmed to fail
the corresponding test before being restored. One tamper round exposed a real gap: the initial
`requireAdminAuth` tests only exercised the pure function, so removing the check from the actual
`/setup/db` route wiring went undetected; end-to-end route tests (`app.fetch(...)`) were added
for all three `/setup/*` routes and confirmed to catch that regression before being trusted.

Researched the correct ElevenLabs webhook-tool auth mechanism before implementing (docs-first):
ElevenLabs' HMAC `ElevenLabs-Signature` header is specifically for **post-call webhooks**, a
different feature; the documented mechanism for **server tool** webhooks like `/convoai/tools`
is a caller-supplied header value in `api_schema.request_headers` (also fixed the field name
here — the old code used `headers`, which is not the field ElevenLabs' current API reads;
`request_headers` is). The shared secret is currently passed as a plain header value rather than
via ElevenLabs' `env_var_label` workspace-secret indirection, which would keep the raw value out
of the agent config readable via `GET /v1/convai/agents/:id`; that's a reasonable follow-up
hardening step, not required to close this incident.

**Not a live-deployment incident in the same way as other findings this campaign**: unlike the
Cloudflare-account-pattern incidents found elsewhere, this repo's live deployment was not probed
for exploitability as part of this pass (a real forged `send_sms` or `/setup/agent` call would
have side effects — real SMS sent, real agent config changed — that a safe read-only test cannot
avoid). Treat the code-level findings above as the basis for urgency regardless.

## Secrets

`ELEVENLABS_API_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `GOOGLE_MAPS_API_KEY`,
`ADMIN_API_KEY`, and `CONVOAI_WEBHOOK_SECRET` are set via `npx wrangler secret put <NAME>` and
are never committed.
