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
- [ ] **⚠️ "Built With" v0 / "scaffolded in v0.app" claim** (`Relay_Devpost_Submission.md` §How we built it
      + Built-With tags). The repo was built with **Kiro** + Claude Code; there are no v0 artifacts. H0 is
      literally "Vercel **v0** + AWS Databases", so claiming v0 you didn't use is an integrity risk —
      either actually scaffold/regenerate the UI in v0, or **strike the v0 references** before submitting.
- [ ] **⚠️ Aurora DSQL screenshot is RELAY's clusters, not orbis's** — see value #5. The `assets/` images
      are the orbis pair; capture relay's `frt34b…`/`fjt34b…` console (both regions' Peers tabs).
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
| 4 | **Demo video URL (public YouTube)** | `PASTE-VIDEO-URL` | Runbook Step 7 — also paste into `README.md` `🎬 Demo video` |
| 5 | **Aurora DSQL screenshots** (cluster + region config) | ⚠️ **NOT YET CAPTURED** — need TWO shots of **relay's** clusters: primary `frt34b…` (us-east-1) + secondary `fjt34b…` (us-west-2), Peers tab. **The files in `../assets/relay-dsql-region*.jpg` are the ORBIS pair (`lbt34…`/`3rt34e6…`) — wrong product, do NOT upload them.** | Runbook Step 6 capture |
| 6 | **Build-post URL** (bonus) | `________________` | `../docs/blog-post.md` → publish to dev.to/Medium/LinkedIn with `#H0Hackathon` |

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
| **Demo video link** | value #4 above | ⏳ needs recording |
| **Try it out / project URL** | value #1 above | ✅ deployed (relay-three-henna.vercel.app) |
| **Vercel project link + Team ID** | values #2, #3 above | ✅ live URL + Team ID known |
| **Architecture diagram (image upload)** | `relay_architecture.png` (in this folder) | ✅ ready — upload the **PNG**, not the SVG |
| **AWS Database screenshot** | value #5 above | ⏳ needs capture |
| **Bonus build post (+attribution + #H0Hackathon)** | value #6 above | ⏳ needs publish |

---

## H0 hard-requirement gate (re-verify the morning of 6-29)

- [ ] Text description names **Amazon Aurora DSQL** as the database used.
- [ ] Demo video **< 3 min**, public/unlisted-public, covers: problem → who/why → working app →
      **live region failover** → Aurora DSQL consistency/OCC explanation.
- [ ] Published **Vercel project link + Team ID** present.
- [ ] **Architecture diagram** uploaded (`relay_architecture.png`).
- [ ] **Aurora DSQL screenshot** uploaded.
- [ ] **Every submitted link opens logged-out / incognito** (project URL, video, repo).
- [ ] *(Bonus)* build post live with `#H0Hackathon` + the verbatim attribution statement.

---

## Engineering gate (Claude-verifiable — GREEN, re-verified live 2026-06-24)

| Gate | State | Command |
|---|---|---|
| Full test suite | ✅ **403 / 58 files** | `npx vitest --run` |
| Types | ✅ clean | `npx tsc --noEmit` (rm `tsconfig.tsbuildinfo` if stale) |
| Build | ✅ clean | `npm run build` |

Re-run all three in the pre-submit pass if any code changed. None of these need Steve.
