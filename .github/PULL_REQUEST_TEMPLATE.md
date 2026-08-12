## What

<!-- What changed and why -->

## Checklist

- [ ] `npm run typecheck` passes
- [ ] `npm test` passes
- [ ] `npm audit` shows no new high/critical vulnerabilities
- [ ] If this touches `verifyTwilioSignature`/`verifyConvoAISecret`/`requireAdminAuth`/
      `timingSafeEqual`, a test was added in `tests/security.test.ts` that fails against the old
      behavior and passes against the new one, tested END-TO-END through the real route
- [ ] `/twilio/*` routes still call `verifyTwilioSignature()` before acting
- [ ] `/convoai/tools` still calls `verifyConvoAISecret()` before executing a tool
- [ ] `/setup/*` routes still call `requireAdminAuth()` first
