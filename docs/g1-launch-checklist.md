# G1 post-verdict merge → deploy → launch checklist

> Written 2026-07-04 (session PRD Story 3, in-lock prep). Executable ONLY after the
> `h0-verdict-disposition` decision is recorded (see `h0-disposition-plan.md` — every W/L/Z
> branch runs G1). Until then master stays frozen. Thresholds, price, budget, and window are
> NOT restated here — they live in `PROJECT.yaml` (gate `g1-caregiver-wtp`),
> `g1-wtp-test-design.md` (decisions table), and `g1-channel-send-kit.md` (budget/lanes).

## Static-survival proof (verified 2026-07-04 on `af4ddf3`) — SUPERSEDED 2026-08-08

> **This section no longer describes the shipped funnel and is kept only as the record of a
> decision that was reversed.** It proved the instrument would survive the 2026-07-25 DSQL/KMS
> teardown. That teardown did not happen — the infra was kept by Steve's ruling — and the premise
> went with it. `/caregivers/interest` now posts to `/api/caregivers/interest`, which writes a
> `caregiver_leads` row, so points 1-3 below are deliberately false as of item 7e.
> 
> The trade was made knowingly: a `mailto:`-only conversion is immune to backend failure and
> captures almost nobody on mobile, which is the traffic this gate buys. A capture path that can
> break is worth more than one that cannot work — provided the break is loud, which is why every
> lead is written to two independent places.

Original text follows.

The G1 instrument provably survives the 7-25 DSQL/KMS teardown:

1. **Zero backend imports.** `grep -rni "dsql|kms|lib/db|lib/auth|lib/kms|pg|connection" src/app/caregivers/`
   → no matches. `content.ts` imports nothing; both pages import only `next/link` + `./content`;
   the root layout imports only fonts/CSS.
2. **No API calls.** Intent capture is the `mailto:` CTA on `/caregivers/interest` — no fetch,
   no form action, no route handler.
3. **Prerendered static.** `next build` marks both routes `○ (Static)`:
   `/caregivers` and `/caregivers/interest`.
4. **Suite green on the branch:** 410/410 (58 base files + `content.test.ts` gate-rule tests).

Re-run all four checks at merge time if the branch has moved past `af4ddf3`.

## Sequence (from the disposition plan's WIN branch; LOSE/ZOMBIE = same minus winner badge)

- [ ] **0. Disposition recorded** — `PROJECT.yaml` `gates.h0-verdict-disposition.met` filled in
  
      (paste-ready blocks: `h0-disposition-plan.md` appendix) + memory updated.

- [ ] **1. jose migration (§B)** on `exp/security-remediation` — one session, gated by the plan's
  
      §B.6 acceptance (22 negative vectors + harness mechanical-only edits + full suite + tsc +
      build + grep completeness). This is pre-committed as the first post-verdict move.

- [ ] **2. Merge order:** `exp/security-remediation` → master, then `exp/g1-caregiver-landing` →
  
      master. (Independent trees — landing touches only `src/app/caregivers/` + docs — so
      conflicts are not expected; the security branch carries the superseding copy of
      `security-remediation-plan.md`, so take ITS version on any docs conflict.)

- [ ] **3. WIN only:** add the "H0 winner ([track])" badge to landing copy + ad variants before
  
      first send (`h0-disposition-plan.md`).

- [ ] **4. Push master** — verdict freeze is over at this point by definition. Vercel auto-deploys.

- [x] **5. Enable Vercel Web Analytics** on the project (dashboard toggle, zero code) — this is
  
      the G1 measurement instrument; without it there is no denominator. **DONE** — confirmed by
      the events themselves, not by the toggle: `caregiver_qualified` and `caregiver_intent` both
      POST **200** to the first-party collector with `src` attached (5b below).

- [x] **5b. Funnel instrument live-proven on relaystandby.com (added and DONE 2026-08-08).**
  
      This was the single largest open risk: every sprint was built on a G1 waiver, so no reading
      was trustworthy, and the custom domain moved the surface after the last check. Driven in a
      real browser at a 390px viewport, `/caregivers?src=reddit_test` -> hero CTA:
      `caregiver_qualified` and `caregiver_intent` both POST 200 to the first-party collector, and
      BOTH payloads carry `src: "reddit_test"` — numerator and denominator share the channel
      vocabulary, so the gate ratio is computable per lane. `cta: "hero"` rides alongside for
      lane-vs-lane analysis. Payloads read off the wire, not inferred from code.

- [x] **6. Live post-deploy probes (re-run 2026-08-09):**
  
      - `/caregivers` → **200**, price visible on CTA, reversibility-led hero. ✅
      - `/caregivers/interest?src=…&cta=…` → **200**, noindex meta present, form renders. ✅
      - `?src=` attribution survives the click-through path AND reaches the `caregiver_leads` row —
        proven 2026-08-08 end to end; rows purged, table read **0 rows** on 2026-08-09.
      - Also probed: `/terms`, `/privacy`, `/demo`, `/robots.txt`, `/sitemap.xml`,
        `/opengraph-image` all **200**; `relay-three-henna.vercel.app` **308 →** the apex;
        `/api/health/scheduler` **200 `healthy:true`**.

- [ ] **7. Teardown-aftermath check (post-7-25 deploys only):** the DB-backed app routes are
  
      expected dead — verify the landing's only outbound links (`/caregivers/interest`, footer
      `/`) don't land a qualified visitor on a 500. If `/` errors without DSQL, point the footer
      link at `/caregivers` or accept the dead home page explicitly — do not silently ship a
      broken first click.

- [x] **7b. Verify a Resend sending domain (added 2026-08-07; DONE 2026-08-08).**
  
      `relaystandby.com` verified in Resend; `RESEND_FROM_ADDRESS=relay@relaystandby.com` set in
      `.env.local` AND in Vercel production (value confirmed via `vercel env pull`, since the env
      listing shows only that a variable exists, not what it holds). Redeployed so the running app
      uses it. A send to `sgharlow+relay@cox.net` — a different domain, and NOT the Resend account
      address — was accepted, which the old shared-domain sender would have rejected outright.
      ORIGINAL NOTE FOLLOWS.
       The sender is currently
      `onboarding@resend.dev`, Resend's SHARED test domain — high spam risk, and the send-only API
      key means delivery cannot be queried. Verify `relaystandby.com` in Resend, add the generated
      SPF/DKIM records in Cloudflare next to the existing A/CNAME, then set
      `RESEND_FROM_ADDRESS=relay@relaystandby.com`. Does NOT block Lane A (its conversion is an
      inbound `mailto:`), but every invitation, owner challenge and verifier notification depends
      on it — i.e. all of Lane B past signup.

- [x] **7c. DMARC + reply capability (added and DONE 2026-08-08).** DMARC published and verified by
  
      DoH. Reply capability shipped as a `Reply-To` header (`RESEND_REPLY_TO_ADDRESS`) and
      live-proven — the reply to test #3 arrived. The cox.net bounces were NOT a DMARC problem:
      cox.net is Yahoo-operated and Yahoo does not support `+tag` addressing, so
      `sgharlow+relay@cox.net` was never a real mailbox. The untagged address delivered.
      Full write-up: `docs/email-dns-runbook.md`.

- [x] **7d. Cloudflare Email Routing — DONE 2026-08-09.** Steve enabled routing; Claude verified
  
      and switched the constant. **`hello@relaystandby.com` is now the public contact** on the
      landing, interest, privacy and terms pages, and the personal Gmail is gone from the shipped
      bundle — checked in the deployed JS chunk, not just the rendered HTML, because two of the
      four occurrences only render in post-submit and error states.
      
      Proven at the mailbox, not at the API. A message sent through the app's own send path to
      `hello@` landed in the **INBOX, not spam**, and so did an external control. The control is
      what makes this meaningful: enabling routing **rewrote the apex SPF**, and had Resend's
      return-path been the apex rather than the `send.` subdomain, every invitation, owner
      challenge and verifier notification would have begun failing SPF at that instant, silently
      and with no code change to blame. `send.` records confirmed intact.
      
      ✅ **Catch-all enabled and proven the same day.** Three different *invented* addresses
      arrived — which is what separates a real catch-all from a few hand-made aliases — plus
      `admin@` and `info@`, with no regression on `hello@`/`relay@`. A customer guessing any
      address now reaches the inbox.
      
      ⚠️ **Never test a forwarding rule from the account it forwards TO.** Gmail deduplicates by
      Message-ID, so the forwarded copy of a message you sent is suppressed and a working route is
      indistinguishable from a broken one. This nearly produced two false findings; Cloudflare
      emits an automated notice about it. Details and the one still-unexplained observation — a
      possible **Resend suppression** on a previously-bounced recipient, which would silently
      affect invitations and verifier notifications — are in `docs/email-dns-runbook.md` §7.
      
      Full evidence table, including the DNS state before and after:
      `docs/email-dns-runbook.md` §6. The original pending note and the Steve/Claude split that
      preceded this are superseded and live in git history (`795b99e`).

- [x] **7e. Lead capture on the intent page (added and DONE 2026-08-08).** `/caregivers/interest`
  
      offered only a `mailto:` link, which on the mobile traffic this gate buys means handing the
      visitor to an app many have never configured: intent would fire on the pageview while no
      contactable human was captured, and the gate would read as if it were working. Replaced with
      a real form writing BOTH a `caregiver_leads` row and a notification email, so a broken
      capture path cannot masquerade as absent demand. Migration 013 applied to live DSQL.
      Live-proven end-to-end from a 390px viewport: `src`/`cta` attribution intact through to the
      row, honeypot silently discards, invalid email 400s, rate limiter 429s. Test rows purged —
      `caregiver_leads` starts the flight at 0.

- [x] **7g. Form spam defences (added and DONE 2026-08-08).** Deliberately NO CAPTCHA: the form's
  
      purpose is measuring conversion, so a visible challenge is friction applied to the exact
      behaviour being measured and biases the gate. reCAPTCHA is additionally excluded because the
      privacy page states there are no advertising or tracking cookies on the site. Shipped
      instead: an off-screen honeypot, and a render-timestamp check rejecting submissions faster
      than a human can type. Both invisible, no vendor, no cookie. Both fail OPEN — a malformed or
      absent timestamp records the lead rather than discarding it, because an anti-spam heuristic
      that can silently drop real demand is worse than spam during a gate that kills on a low
      number. Live-proven: instant and 1-second submissions discarded with no row and no email,
      malformed timestamp recorded, genuine human-speed submission through the real form recorded
      with `cta` attribution intact. **Escalation path if spam actually materialises:** Cloudflare
      Turnstile (free, DNS already there, no tracking cookie) — NOT reCAPTCHA. Trigger: more than
      a handful of junk rows in `caregiver_leads` during the flight.

- [x] **7f. Ad-surface metadata (added and DONE 2026-08-08).** `metadataBase` still declared
  
      `relay-three-henna.vercel.app`, so every `og:url`/`og:image` — including what Meta and Reddit
      crawl during ad review — pointed at the pre-domain deployment. Now `relaystandby.com`, with a
      caregiver-specific share card (the root card sells Aurora DSQL and a state machine, which is
      the wrong pitch for this audience), plus `robots.txt` and `sitemap.xml`, both previously 404.
      `/caregivers/interest` stays noindexed so intent counts paid clicks, not organic arrivals.

- [x] **7h. The money path can be stopped, live-proven (added and DONE 2026-08-09).** The cancel
  
      button had shipped as *wired, not live-proven*: `billingPortal.sessions.create` fails outright
      unless the customer portal has been saved once in LIVE mode, and that could not be checked
      from the repo because `STRIPE_SECRET_KEY` is a Vercel *sensitive* variable and pulls back
      empty. Settled by signing in as the real paying account and clicking the button: the portal
      returned a **`live_` session** and rendered the real subscription — $119.00/yr, next billing
      date, card on file, invoice history, and a working **Cancel subscription** control. Nothing
      was cancelled. **Finding recorded, not fixed:** the portal header reads
      "Relay/ReportBridge/LearningAI365" (shared-account business name) — ratified as leave-as-is
      for this flight, see `PROJECT.yaml` `ratified.stripe-merchant-name`.

- [x] **7i. Sign-in stopped telling strangers who has an account (added and DONE 2026-08-09).**
  
      Found while probing the above. An email with no row fell through to the shared env TOTP
      secret, which is 20 base32 characters — under otplib's 128-bit floor and not byte-aligned —
      so decoding threw, and NextAuth reflects a throw out of `authorize` into
      `/api/auth/error?error=<message>`. A registered address returned `CredentialsSignin`; an
      unregistered one returned `Invalid Base32 string: Non-zero padding: 192`. That is an
      account-enumeration oracle on the surface ads point at, and it undid the property the signup
      rate limiter was deliberately built to have. The same fallthrough meant a holder of the env
      secret could authenticate as any *new* address, which `authorize` then upserts. Fixed, and
      **re-verified on production: all four cases — registered, legacy, and two never-existed —
      now return byte-identical responses.**

- [x] **7j. Refund stance ratified (2026-08-09).** 30-day money-back guarantee on every charge,
  
      renewals included, then no refund of the unused part of a year. Single definition in
      `lib/offer.ts`, consumed by the Terms and both price cards, pinned by a test that the copy
      keeps routing to a human — Stripe's portal cancels without refunding and nothing in the
      codebase issues a refund, so refunds are **issued by hand in the Stripe dashboard**.

- [ ] **8. Launch paid lanes** per `g1-channel-send-kit.md` (ratified budget ceiling; `src`
  
      values per lane). Organic participation stays Steve-voice-only per the channel-rules audit.
      **Paste-ready one-sitting walkthrough for both lanes: `docs/g1-ad-creatives.md`.**
      ⚠️ Its "verify the instrument" step is not optional — click your own live ad and confirm both
      events carry `src` before letting a lane run a full day.

- [ ] **9. Log window start date** + N-counting rules in the gate tracking note; the gate
  
      hard-stops per `PROJECT.yaml` (`g1-caregiver-wtp`, due 2026-09-15).

## Rollback

Landing is additive + static: rollback = revert the landing merge commit (or `vercel rollback`
to the prior deployment). No data, no schema, no env vars involved.
