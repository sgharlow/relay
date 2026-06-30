# Relay — Devpost Paste Map (turnkey field fill)

**Hackathon:** H0 "Hack the Zero Stack with Vercel and AWS Databases" · AWS Database: **Amazon Aurora DSQL** · deadline **2026-06-29 5:00pm PDT** (submit by **6-27**).
**Sibling entry:** `orbis-exchange` (Track 3) — same deadline.

> This file is the single **field-by-field** map for the Devpost form: each row says *what to paste*
> and *where the source text lives*. The prose blocks already exist in
> [`Relay_Devpost_Submission.md`](Relay_Devpost_Submission.md) — do not rewrite them here, just paste.
> The ordered cliff-day path (provision → deploy → dogfood → capture) is
> [`../docs/SUBMISSION-RUNBOOK.md`](../docs/SUBMISSION-RUNBOOK.md).

---

## ⚠️ Confirm before submitting (do not guess)

- **Track: Monetizable B2C — LOCKED.** Select "Monetizable B2C" on the form (the build spec's
  "Track 1 — Monetizable B2C" is the same track). No further confirmation needed.
- [x] **v0 references struck (2026-06-24).** "scaffolded in v0.app" + the `v0` Built-With tag removed from
      the Devpost pack and the build spec (the repo wasn't built with v0). Only the hackathon's official
      name ("Vercel v0 …") remains, which is fine.
- [x] **✅ Aurora DSQL screenshots ARE relay's clusters (verified 2026-06-29 audit)** — see value #5.
      `demo-out/useast1_.jpg` = primary `frt34buqso4inluojgnj6horuy` (us-east-1); `demo-out/uswest2_.jpg`
      = secondary `fjt34b2el5yoh7pvcm4knbkyvi` (us-west-2); both Active with mutual active-active peering
      (witness us-east-2). (Gitignored — Devpost-upload only, won't leak account ID to the public repo.)
      Active-active was verified live — a us-east-1 write read strongly-consistent from us-west-2.
- [ ] **Bonus attribution wording.** The "created for this hackathon" statement wording is set by the
      Official Rules — copy it verbatim into the build post.

---

## The 6 user-supplied values (everything else is already written)

Fill these in as you complete the runbook; they are the *only* things blocking the form:

| # | Field | Value (paste when you have it) | Where it comes from |
|---|---|---|---|
| 1 | **Vercel production URL** | `https://relay-three-henna.vercel.app` ✅ | deployed live |
| 2 | **Vercel project link** | `https://relay-three-henna.vercel.app` (the working app a judge clicks) | Vercel → Project |
| 3 | **Vercel Team ID** | `team_nP3HzRc3PNm6SaWiApTGkEWa` ✅ | Vercel → Team → Settings → General |
| 4 | **Demo video URL (public YouTube)** | `https://youtu.be/FU3azKJOesY` ✅ | Runbook Step 7 — also pasted into `README.md` `🎬 Demo video` |
| 5 | **Aurora DSQL screenshots** (cluster + region config) | ✅ **CAPTURED & VERIFIED** — `../demo-out/useast1_.jpg` (primary `frt34buqso4inluojgnj6horuy`, us-east-1, peer us-west-2, witness us-east-2) + `../demo-out/uswest2_.jpg` (secondary `fjt34b2el5yoh7pvcm4knbkyvi`, us-west-2, peer us-east-1, witness us-east-2). Confirmed relay's OWN clusters (2026-06-29 audit), mutual active-active peering. (Optional: crop the unrelated `wrt3a5…` cluster out of the us-east-1 shot.) | Runbook Step 6 capture — DONE |
| 6 | **Build-post URL** (bonus) | `https://x.com/SGHarlow/status/2071618513920503978` ✅ | X (Twitter) thread — `#H0Hackathon` + attribution; source `../demo-out/x-thread.md` |

---

## Field-by-field map (Devpost form → source)

| Devpost field | Paste from | Status |
|---|---|---|
| **Project name** | `Relay` | ✅ ready |
| **Tagline** | `Relay_Devpost_Submission.md` → "Tagline" | ✅ ready |
| **Inspiration** | `Relay_Devpost_Submission.md` → "Inspiration" | ✅ ready |
| **What it does** | `Relay_Devpost_Submission.md` → "What it does" | ✅ ready |
| **How we built it** | `Relay_Devpost_Submission.md` → "How we built it" | ✅ ready |
| **Which AWS Database (names Aurora DSQL)** | `Relay_Devpost_Submission.md` → "Which AWS Database — and why Aurora DSQL" | ✅ ready |
| **Challenges** | `Relay_Devpost_Submission.md` → "Challenges we ran into" | ✅ ready |
| **Accomplishments** | `Relay_Devpost_Submission.md` → "Accomplishments we're proud of" | ✅ ready |
| **What we learned** | `Relay_Devpost_Submission.md` → "What we learned" | ✅ ready |
| **What's next** | `Relay_Devpost_Submission.md` → "What's next for Relay" | ✅ ready |
| **Built With (tags)** | `Relay_Devpost_Submission.md` → "Built With" | ✅ ready |
| **Demo video link** | value #4 above | ✅ published (youtu.be/FU3azKJOesY) |
| **Try it out / project URL** | value #1 above | ✅ deployed (relay-three-henna.vercel.app) |
| **Vercel project link + Team ID** | values #2, #3 above | ✅ live URL + Team ID known |
| **Architecture diagram (image upload)** | `relay_architecture.png` (in this folder) | ✅ ready — upload the **PNG**, not the SVG |
| **AWS Database screenshot** | value #5 above | ✅ captured & verified (relay's frt34b…/fjt34b… clusters) |
| **Bonus build post (+attribution + #H0Hackathon)** | value #6 above | ✅ published (x.com/SGHarlow/status/2071618513920503978) |

---

## H0 hard-requirement gate (re-verify the morning of 6-29)

- [ ] Text description names **Amazon Aurora DSQL** as the database used.
- [ ] Demo video **< 3 min**, public/unlisted-public, covers: problem → who/why → working app →
      **live region failover** → Aurora DSQL consistency/OCC explanation.
- [ ] Published **Vercel project link + Team ID** present.
- [ ] **Architecture diagram** uploaded (`relay_architecture.png`).
- [ ] **Aurora DSQL screenshot** uploaded.
- [ ] **Every submitted link opens logged-out / incognito** (project URL, video, repo).
- [x] *(Bonus)* build post live with `#H0Hackathon` + the verbatim attribution statement — <https://x.com/SGHarlow/status/2071618513920503978>

---

## Engineering gate (Claude-verifiable — GREEN, re-verified live 2026-06-27)

| Gate | State | Command |
|---|---|---|
| Full test suite | ✅ **405 / 58 files** | `npx vitest --run` |
| Types | ✅ clean | `npx tsc --noEmit` (rm `tsconfig.tsbuildinfo` if stale) |
| Build | ✅ clean | `npm run build` |

Re-run all three in the pre-submit pass if any code changed. None of these need Steve.
