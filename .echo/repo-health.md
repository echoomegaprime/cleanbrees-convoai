# ECHO Repository Health Receipt

Source repository: `echoomegaprime/cleanbrees-convoai`

Source commit: `3561500831d7afa5351be0117fb0f14e5affae51`

Updated manually as part of the GitHub Certified Consolidation of the legacy
`ECHO-OMEGA-PRIME/cleanbrees-convoai` repository (2026-08-12). The GitHub App Suite that
would post this automatically is affected by build #29466 (`actions/runs` returns
`total_count: 0` for every commit on this account; re-confirmed on this repo before writing
this receipt).

Cert Forge `PRODUCTION_READY` was obtained via `POST /v1/certifications`
(`cert_9056ec77e362ff3d10833a8ef6c02ba9cf0c8539`), confirmed via the signed ed25519 verdict
payload (`signing_key_id: ed25519:a07f417e23d6ef50e316f046c115b9fc`,
`evidence_merkle_root: b44e6869ed7753e703bfc542f86895c39fea1b97a82a7aa9ad496a270b42198c`).

## Showroom floor audit

- [x] `README.md` — architecture, endpoint table, config/secrets table, Security section, quickstart
- [x] `LICENSE`
- [x] `SECURITY.md` — full incident writeup for all 3 fixes
- [x] `CONTRIBUTING.md`
- [x] `CODE_OF_CONDUCT.md`
- [x] `CHANGELOG.md`
- [x] `.gitignore` (`node_modules/`, `.wrangler/`, `.dev.vars`, `__pycache__/`, `*.pyc`)
- [x] `.github/workflows/ci.yml` (typecheck + test + audit)
- [x] `.github/PULL_REQUEST_TEMPLATE.md` + `ISSUE_TEMPLATE/`

Result: **9/9 present**.

## GUI fitness gate

This is a backend Cloudflare Worker (Twilio + ElevenLabs webhooks, D1-backed). It has no GUI of
its own — the GUI fitness gate does not require this repo to ship one.

## Secret-literal scan

`git grep --untracked -InE 'sk-live|sk_live|AKIA[0-9A-Z]{16}|gho_[A-Za-z0-9]{36}|ecf_live|-----BEGIN'`
across the full tracked tree (excluding `package-lock.json`): **0 matches**.

## CRITICAL security fixes verified in this commit — read before relying on this certification

**Unauthenticated ConvoAI tool webhook.** `POST /convoai/tools` had no authentication at all —
an open endpoint that could send arbitrary SMS from the business's real Twilio number (attacker
chooses recipient and message), write bogus bookings into the live scheduling database, or
trigger an SMS alert to the owner's personal phone with attacker-controlled content. Fixed with
`verifyConvoAISecret()` — a shared secret ElevenLabs now sends back as `X-ConvoAI-Secret` on
every real tool call, wired into the agent's own `api_schema.request_headers` config by
`createOrUpdateAgent()`, which refuses to publish an agent config at all if
`CONVOAI_WEBHOOK_SECRET` is unset.

**Unauthenticated Twilio webhooks.** `/twilio/voice`, `/twilio/status`, `/twilio/forward` never
checked `X-Twilio-Signature`. A forged `/twilio/forward` POST in particular could ring the
owner's personal phone at will. Fixed with `verifyTwilioSignature()`, reimplementing Twilio's
own HMAC-SHA1 signature algorithm via `crypto.subtle` (confirmed against Twilio's official
`twilio-node` source before implementing).

**Unauthenticated admin routes.** `/setup/agent`, `/setup/twilio`, `/setup/db` had no auth.
`/setup/agent` in particular rewrites the entire live ConvoAI agent config (system prompt,
voice, tools) using the real `ELEVENLABS_API_KEY` — anyone could have silently changed what
"Bree" says to real callers. Fixed with `requireAdminAuth()` (`X-Echo-API-Key`,
`timingSafeEqual`, fails closed `503` if unconfigured).

Also fixed a functional bug found during the same review: `createOrUpdateAgent()` was setting
the field `headers` on `api_schema`, which is not what ElevenLabs' current API reads for
webhook-tool configuration (`request_headers` is) — confirmed via ElevenLabs' own documentation
before changing, per this fleet's docs-first doctrine, rather than assumed from training data.

`tests/security.test.ts` (20/20 passing) covers all three auth mechanisms and was
**tamper-tested against each independently**. One tamper round exposed a genuine coverage gap:
the first pass of `requireAdminAuth` tests only exercised the pure function, so removing the
check from the real `/setup/db` route handler went undetected by the suite; end-to-end route
tests (`app.fetch(...)`) were added for all three `/setup/*` routes and confirmed to catch that
exact regression before being trusted. `scripts/certforge_journey.py` independently re-verifies
all three gates via source inspection and was itself tamper-tested (an initial regex bug in the
journey script caused a false negative on its own first run — fixed and reverified before this
certification was trusted).

**Not probed live**: unlike other findings in this campaign, this repo's live legacy deployment
was **not** tested for exploitability — a real forged `send_sms` or `/setup/agent` call has
irreversible side effects (a real SMS sent, a real agent config changed) that cannot be safely
undone by a read-only verification probe. The code-level findings and fixes above stand
independent of live-deployment status. This certificate covers the code in this repository only.
