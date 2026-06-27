# Relay — Narration Script (for relay-demo-silent.mp4)

Read this over the silent video `demo-out/relay-demo-silent.mp4` (1:48, 1080p).
Pacing is ~2.3 words/sec; the timecodes are where each beat starts on the video.
The video holds each shot long enough to read its line at a natural pace — if you
run a little long, just keep going, the next cut is forgiving. Plain ASCII; no
encoding characters.

Hits every Devpost requirement: the problem, who it's for, why, the working app,
and the AWS database choice (Amazon Aurora DSQL).

------------------------------------------------------------
[0:00] INTRO CARD (3s)  -- title card, let it sit (or start the first line here)

[0:03] LANDING PAGE (13s)
When someone can't be there - a hospital stay, a trip, or worse - the people who
depend on them can't reach the accounts that matter. Relay is standby access for
exactly that moment.

[0:16] THE VAULT + IMPORTANCE ENGINE (15s)
You build one encrypted vault - accounts, documents, instructions. Relay's
importance engine ranks what matters in a crisis and flags the real risk: your
primary email is the key that unlocks most password resets. It only ever sees
metadata - never your secrets.

[0:31] ACCESS RULES (9s)
Then you set the rules: who gets which item, and under which trigger - an
emergency, travel, caregiving, or one day, your estate.

[0:40] TRIGGERS - ARMED (7s)
Every trigger sits ARMED by default. Nothing releases unless the conditions you
defined are actually met.

[0:47] RELEASE BEGINS (4s)
When an emergency fires, Relay runs a controlled release -

[0:51] RELEASED (7s)
ARMED, to PENDING, to a grace window, to RELEASED. Every step is a strongly
consistent transaction that can never double-release.

[0:58] RECIPIENT'S PLAN (10s)
The recipient opens one scoped link and gets a calm, prioritized plan - do this
first - showing only what they were granted, and only because a real release
happened.

[1:08] REVEAL (10s)
They reveal an item and it's decrypted right in their browser - the safe code,
where the will is, who the executor is. Exactly what they need, and nothing more.

[1:18] AUDIT LOG (9s)
Every step is written to an append-only, hash-chained audit log - tamper-evident,
and verified here both on the server and in the browser.

[1:27] ARCHITECTURE / AURORA DSQL (16s)
Under the hood this runs on Amazon Aurora DSQL - active-active across regions,
strongly consistent. The release is a compare-and-set on DSQL's optimistic
concurrency, so even a regional outage can't stop access or corrupt it. And every
secret is envelope-encrypted with AWS KMS, so the database only ever holds
ciphertext.

[1:43] OUTRO CARD (5s)
Relay - standby access for the people who'll need it.

------------------------------------------------------------
TOTAL ~1:48. Well under the 3:00 cap.

How to finish:
1. Record your voice reading the above (phone voice-memo is fine), watching the
   silent video so you land each line on its beat.
2. Either drop the audio onto the video in any editor, OR send me the audio file
   and I'll sync + mux it onto relay-demo-silent.mp4 (same as the orbis flow).
3. Upload PUBLIC to YouTube; paste the URL into README + specs/DEVPOST-PASTE-MAP.md
   + the Devpost "Demo video" field.

Note on the multi-region beat: the narration says "active-active across regions"
and "even a regional outage can't stop access" - both are TRUE and were verified
(a release written in us-east-1 was read strongly-consistent from us-west-2). The
video shows the architecture diagram for this beat rather than a live failover, so
nothing is overstated. If you want a live-failover shot instead, see
demo-out/RECORDING-PLAN.md cue 4 (env flip + redeploy) and capture it manually.
