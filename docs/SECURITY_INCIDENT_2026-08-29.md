# Security Incident Note — 2026-08-29

Full cross-org report: [`auernyx-agent-mk2/docs/SECURITY_INCIDENT_2026-08-29.md`](https://github.com/Auernyx-com/auernyx-agent-mk2/blob/main/docs/SECURITY_INCIDENT_2026-08-29.md)

## What happened here specifically

The Cloudflare Access application protecting `squad.wyerd.org` had been removed and was never restored. `/tool/` — the live veteran intake form — was reachable with HTTP 200 and no gate, no login redirect, nothing. Confirmed live before any fix was applied.

## Reason for the delay

Justin was running Cloudflare Access's email-OTP gate here specifically because of real funding constraints at the time — it was what was affordable. He removed it before relocating, didn't discover the severity of the resulting exposure until later, and by then only had a phone available — no practical path to fix it remotely. It sat open from that point until tonight, 2026-08-29.

## Disposition

1. Site content replaced with a maintenance page — plain notice that Pathfinder is offline for a security fix, with the VA main line and Veterans Crisis Line included so nobody arriving with a real need is stranded. Deployed and cache-purged; confirmed live on `/`, `/tool/`, and `/tool/index.html`.
2. The paired backend (`pathfinder-worker`) was deleted entirely — see that repo's own incident note.
3. Separately, and unrelated to the Access removal: the client-side session vault (`encryptSession`/`decryptSession` in `tool/index.html`) was fully audited on the same night. It held up — real Web Crypto API, correct random salt/IV generation (fresh IV every encrypt call), passphrase and plaintext confirmed to never leave the device. One real gap found: PBKDF2 was at 150,000 iterations (reasonable a few years ago, below current OWASP guidance). Bumped to 600,000. **Existing vaults will need to be reset** — the iteration count is baked into the derived key, there is no migration path for a vault created under the old count.

## What comes back online, and when

Not this maintenance page as-is, and not the old code either. The real fix in progress: a public tier with zero server-side disclosure capability by design, and a separate closed session — Cloudflare Access + GitHub OAuth, using GitHub's own 2FA rather than a hand-rolled system — for anything privileged (feedback review, complaint data). `squad.wyerd.org` stays on the maintenance page until that exists. See the central report's Open Items for exact status.
