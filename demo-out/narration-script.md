# Relay — Narration Script (for relay-demo-silent.mp4)

Read this over the silent video `demo-out/relay-demo-silent.mp4` (1:59, 1080p).
This cut shows the REAL verified-release flow (initiate -> grace -> a verifier
confirms -> released) and the reversible close (owner checks in -> the recipient's
link goes dead). Pacing is ~2.3 words/sec; timecodes are where each beat starts.
Plain ASCII; the video holds each shot long enough to read its line at a natural
pace - if you run a little long, keep going, the next cut is forgiving.

Hits every Devpost requirement: the problem, who it's for, why, the working app,
and the AWS database choice (Amazon Aurora DSQL).

------------------------------------------------------------
[0:00] INTRO CARD (3s)  -- title card, let it sit (or start the first line here)

[0:03] THE PROBLEM (landing page)
When someone can't be there - a hospital stay, a trip, or worse - the people who
depend on them can't reach the accounts that matter. Relay is standby access for
exactly that moment.

[0:15] THE VAULT + IMPORTANCE ENGINE
You build one encrypted vault - accounts, documents, instructions. Relay's
importance engine ranks what matters in a crisis and flags the real risk: your
primary email is the key that unlocks most password resets. It only ever sees
metadata - never your secrets.

[0:29] ACCESS RULES
You set the rules: who gets which item, under which trigger. Here, the family
safe and will is scoped to Jordan, under an emergency.

[0:38] TRIGGERS - ARMED
Every trigger sits ARMED by default. Nothing releases unless the conditions you
set are actually met.

[0:45] AN EMERGENCY IS RAISED -> GRACE
When an emergency is raised it doesn't just open - it moves into a grace window
and waits, because access this sensitive has to be verified.

[0:53] A VERIFIER CONFIRMS -> RELEASED
A trusted verifier confirms - real people, N-of-M - and only then does the
release complete. Every transition is a strongly consistent compare-and-set, so
it can never double-release.

[1:02] THE RECIPIENT'S PLAN
The recipient opens one scoped link and gets a calm, prioritized plan - do this
first - showing only what they were granted.

[1:11] REVEAL
They reveal an item and it's decrypted right in their browser - the safe code,
where the will is, who the executor is.

[1:20] REVERSIBLE - ACCESS CLOSES
And it's reversible. The owner recovers, checks in - and the access closes
automatically. The recipient's link goes dead, and everything returns to ARMED.

[1:29] AUDIT LOG
Every step - initiated, verified, released, recovered - is written to an
append-only, hash-chained audit log, verified on the server and in the browser.

[1:39] ARCHITECTURE / AURORA DSQL
All of it runs on Amazon Aurora DSQL - active-active across regions, strongly
consistent. The release is a compare-and-set on DSQL's optimistic concurrency, so
even a regional outage can't stop access or corrupt it. And every secret is
envelope-encrypted with AWS KMS, so the database only ever holds ciphertext.

[1:54] OUTRO CARD (5s)
Relay - standby access for the people who'll need it.

------------------------------------------------------------
TOTAL ~1:59. Well under the 3:00 cap.

How to finish:
1. Open demo-out/teleprompter.html - the silent video plays on the left and each
   line lights up READ NOW on the right at its cue. Hit Space and read along.
2. Record your voice (phone is fine), or send me the audio file and I'll sync +
   mux it onto relay-demo-silent.mp4 (same as the orbis flow).
3. Upload PUBLIC to YouTube; paste the URL into README + specs/DEVPOST-PASTE-MAP.md
   + the Devpost "Demo video" field.

Everything in this cut was performed live on the deployed app on Amazon Aurora
DSQL: a real owner-initiated emergency, a real N-of-M verifier confirmation
driving the release, a real in-browser KMS decrypt, and a real reversible close.
Nothing is faked or simulated.
