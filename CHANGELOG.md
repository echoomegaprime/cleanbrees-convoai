# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

### Security

- **CRITICAL**: `POST /convoai/tools` had NO authentication — an open endpoint that could send
  arbitrary SMS from the business's real Twilio number, write bogus bookings, or trigger an
  SMS alert to the owner's personal phone with attacker-controlled content. Added
  `verifyConvoAISecret()`, a shared-secret header ElevenLabs now sends back on every real tool
  call (`createOrUpdateAgent()` refuses to publish an agent config without it configured).
- **HIGH**: `/twilio/voice`, `/twilio/status`, `/twilio/forward` had no `X-Twilio-Signature`
  verification. Added `verifyTwilioSignature()` (Twilio's HMAC-SHA1 algorithm, reimplemented via
  `crypto.subtle`, constant-time compared).
- **HIGH**: `/setup/agent`, `/setup/twilio`, `/setup/db` had no authentication — anyone could
  silently rewrite the live voice agent's entire configuration using our own ElevenLabs key.
  Added `requireAdminAuth()` (`X-Echo-API-Key`, fails closed 503 if unconfigured).
- Fixed the agent-config field name: `createOrUpdateAgent()` was setting `headers` on
  `api_schema`, which ElevenLabs' current API does not read; the correct field is
  `request_headers` (confirmed via ElevenLabs docs before changing).
- Added `tests/security.test.ts` (20 tests), tamper-tested against all three auth mechanisms
  independently. One round exposed a real coverage gap — `requireAdminAuth` unit tests didn't
  catch the check being removed from the actual `/setup/db` route wiring — closed by adding
  end-to-end route tests for all three `/setup/*` routes.

### Added

- `tsconfig.json` test include, `vitest`, `npm run typecheck` / `npm test`.
- `LICENSE`, `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, this file, CI workflow,
  issue/PR templates.

## Prior history

See `git log` for the pre-consolidation commit history (v2.0.0 RAH handyman services, emergency
forwarding, dynamic pricing).
