# Email DNS runbook — relaystandby.com

> Written 2026-08-08 after two Resend-accepted sends failed to land at a `cox.net` address.
> DNS changes are Steve's to apply per the standing infra policy; this file holds the exact values.

## What is already correct

Verified live via DoH, so this is observed state and not the Resend dashboard's opinion:

| Record | Value | Status |
|---|---|---|
| `send.relaystandby.com` TXT | `v=spf1 include:amazonses.com ~all` | ✅ |
| `send.relaystandby.com` MX | `10 feedback-smtp.us-east-1.amazonses.com` | ✅ |
| `resend._domainkey.relaystandby.com` TXT | DKIM public key | ✅ |

SPF and DKIM authentication is set up properly. The Resend domain verification worked.

## 1. The likely cause of non-delivery: no DMARC

There is **no `_dmarc` record**. For a brand-new domain this is the single highest-impact gap.

`cox.net` is operated by **Yahoo**. Since February 2024 Yahoo and Google have required DMARC from
bulk senders and weight it heavily for domains with no sending history. A first-ever message from
an unknown domain with SPF and DKIM but **no DMARC policy** is the profile most likely to be
dropped silently rather than filed as spam — which matches exactly what we saw.

**Add in Cloudflare DNS — TXT, DNS only (grey cloud):**

| Field | Value |
|---|---|
| Type | `TXT` |
| Name | `_dmarc` |
| Content | `v=DMARC1; p=none; rua=mailto:dmarc@relaystandby.com; fo=1` |

`p=none` is deliberate: it asks receivers to report rather than reject, which is the correct
starting posture for a domain with no reputation. Tighten to `p=quarantine` only after the
aggregate reports show authentication passing consistently.

The `rua=` address needs to exist to receive reports — Email Routing (step 2) covers it.

## 2. Reply capability — Cloudflare Email Routing

`relay@relaystandby.com` currently **cannot receive replies**; the apex has no MX record. A
caregiver who gets *"someone is asking for access to your parent's vault"* and hits reply is
talking to nobody, which is a poor look for a product selling trust.

Cloudflare Email Routing forwards to an existing inbox, free, and adds the apex MX automatically.

**In the Cloudflare dashboard → Email → Email Routing → Enable.** It creates:

| Type | Name | Value | Priority |
|---|---|---|---|
| MX | `@` | `route1.mx.cloudflare.net` | 12 |
| MX | `@` | `route2.mx.cloudflare.net` | 46 |
| MX | `@` | `route3.mx.cloudflare.net` | 89 |
| TXT | `@` | `v=spf1 include:_spf.mx.cloudflare.net ~all` | — |

Then add these custom addresses, both forwarding to a real inbox:

- `relay@relaystandby.com` → replies to notifications
- `dmarc@relaystandby.com` → the DMARC aggregate reports from step 1

⚠️ **Apex SPF interaction.** Email Routing adds an apex SPF record for *inbound* routing. Resend
sends from the `send.` subdomain, which carries its own SPF, so the two do not conflict — but do
**not** replace the `send.` record with the apex one, and do not merge them.

## 3. Diagnosing where the two sends actually went

Resend accepted both (message ids returned), so they left our side. The **Resend dashboard →
Emails** shows per-message status: `delivered`, `bounced`, `complained`, or `deferred`.

That distinction decides the next move, and no amount of resending will reveal it:

| Dashboard says | Meaning | Action |
|---|---|---|
| `bounced` | Cox rejected at SMTP | Read the bounce reason; usually policy/reputation |
| `delivered` | Cox accepted it | It is in spam or a Yahoo policy folder — DMARC is the fix |
| `deferred` | Greylisted, still retrying | Wait; new-domain greylisting is normal |

The API key in `.env.local` is **send-only**, so this cannot be queried programmatically. The
dashboard is the fastest path.

## 4. Retesting

After DMARC is added, allow ~15 minutes for propagation, then resend and check **inbox and spam**.

Prefer a **consumer** address for the test (Gmail, Outlook.com, Yahoo/Cox). A corporate mailbox is
the hardest possible target — enterprise filters such as Microsoft 365 and Proofpoint are far more
aggressive than consumer providers, so a failure there tells you nothing you did not already know,
and a success there does not predict consumer delivery. Test the audience you are actually
emailing: caregivers on consumer email.
