# Relay — Demo Video Recording Plan

**Target:** ~2:15, **hard cap 3:00.** Public on YouTube. 1080p/30fps, full-screen
browser, hide bookmarks, quiet notifications. Names **Amazon Aurora DSQL** out loud.

**Workflow (same idea as orbis, adapted):** relay's demo is a *live, multi-actor* flow
(owner → recipient → verifiers + a real region failover), so it can't be auto-captured —
you **screen-record the real app** while reading the **timer teleprompter**
(`demo-out/teleprompter.html`). Open the teleprompter on a second screen / phone, hit
**Start** the instant you begin recording, and read each line as it lights up. Each cue
shows a **▸ ON SCREEN** note for what to be doing.

---

## Pre-flight (do once, before recording)

1. **Sign-in:** owner is `demo@relay.test`. You'll need the live **TOTP** code from the
   authenticator app you set up at go-live (the `TOTP_SECRET` in Vercel prod). Have the
   6-digit code ready at record time.
2. **Recipient email = `sgharlow+relay@gmail.com`** (your real inbox via the `+` alias).
   Set the emergency recipient (Dave) to this address so the access-link email actually
   arrives on camera. *(Resend sends from `onboarding@resend.dev` — with the shared test
   sender it can only deliver to the Resend account's own verified address, so confirm the
   account is `sgharlow@gmail.com`; the `+relay` alias lands in the same inbox.)*
3. **Two browser profiles / windows:** one signed in as the **owner** (Maria), one
   **incognito** for the **recipient** (Dave) opening the `/access?token=…` link.
4. **Have the import file ready** (a small password-manager CSV) for the "import" beat.
5. **Reset the demo state** so the release starts at `ARMED` and the vault is clean.

---

## Shot sequence (matches the teleprompter cues)

| Cue | ~Time | On screen |
|---|---|---|
| 1 | 0:05 | Relay landing / sign-in (or a title) — set the problem |
| 2 | 0:24 | **Import** a CSV → vault populates → **importance ranking** + the flagged gap (primary email has no recovery note) → **assign emergency access** to Dave (`sgharlow+relay@gmail.com`) + **name verifiers** |
| 3 | 1:02 | Recipient (incognito) **requests access** → owner **notified, no response** → **verifiers confirm** → recipient's **scoped, prioritized plan** opens |
| 4 | 1:32 | **Live region failover:** set `DSQL_USE_SECONDARY=true` in Vercel → redeploy/restart → reload the recipient `/access` view → it **keeps working** from us-west-2 (Oregon). **Reset the flag to false after.** |
| 5 | 1:52 | **Reversible:** owner **checks in** → release returns to `ARMED` → recipient access **closes** |
| 6 | 2:04 | **Architecture diagram** (`specs/relay_architecture.png`) — Aurora DSQL + the release state machine (compare-and-set / OCC, no foreign keys) |
| 7 | 2:22 | Back to the Relay vault / a title card |

> **If you want to skip the live failover on camera** (it needs an env flip + redeploy),
> narrate cue 4 over the architecture diagram instead and show the DSQL multi-region config —
> the words still hold ("active-active across two regions"). The **storage screenshots are
> deferred for now** per your call, so cue 6's diagram carries the DSQL-proof visual.

---

## After recording

1. **(Optional) Bookend with cards:** `demo-out/intro-card.png` / `demo-out/outro-card.png`
   (relay-branded). Prepend ~4s / append ~5s in your editor, or with ffmpeg:
   ```bash
   ffmpeg -loop 1 -t 4 -i demo-out/intro-card.png -i your-recording.mp4 -loop 1 -t 5 -i demo-out/outro-card.png \
     -filter_complex "[0:v]fps=30,scale=1920:1080,setsar=1,format=yuv420p[a];[1:v]fps=30,scale=1920:1080,setsar=1,format=yuv420p[b];[2:v]fps=30,scale=1920:1080,setsar=1,format=yuv420p[c];[a][b][c]concat=n=3:v=1:a=0[v]" \
     -map "[v]" -c:v libx264 -pix_fmt yuv420p -crf 20 demo-out/relay-demo-final.mp4 -y
   ```
2. **Keep it under 3:00.** Trim dead air.
3. **Upload PUBLIC to YouTube** (not unlisted-only for the bonus; the demo itself can be
   public or unlisted-public). Paste the URL over **`PASTE-VIDEO-URL`** in `README.md` and
   `specs/DEVPOST-PASTE-MAP.md`, and into the Devpost **Demo video** field.

## Checklist before upload
- [ ] Under 3:00 · names **Amazon Aurora DSQL** on screen + out loud
- [ ] Shows the working app + the **release** flow (emergency → access → reversible close)
- [ ] Shows the **multi-region** story (live failover *or* the DSQL config / diagram)
- [ ] Every submitted link opens **logged-out / incognito**
