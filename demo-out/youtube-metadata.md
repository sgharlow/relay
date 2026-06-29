# Relay — YouTube video metadata (paste-ready, plain ASCII)

**PUBLISHED:** https://youtu.be/FU3azKJOesY (public)

Use these when you upload the demo video to YouTube. Set the video to PUBLIC.
After uploading, paste the URL into README.md, specs/DEVPOST-PASTE-MAP.md, and the
Devpost "Demo video" field.

============================================================
TITLE  (89 chars; YouTube max 100)
============================================================
Relay - verified, reversible standby access on Amazon Aurora DSQL | H0 Hackathon

============================================================
DESCRIPTION
============================================================
Relay is a living-continuity vault: an encrypted vault of your accounts,
documents, and instructions, with scoped, reversible access that opens only under
rules you set - and only after trusted verifiers confirm. When you can't be there
- a hospital stay, a trip, or worse - the right people can reach exactly what they
need, and not a moment before. Emergencies are reversible; estate handoffs are
permanent.

This demo is performed live on the deployed app:
- The importance engine ranks a vault by what matters in a crisis (your primary
  email is the key that unlocks most password resets) - seeing non-secret
  metadata only, never your secrets.
- A trigger fires two ways: automatically if you stop checking in (a
  dead-man's-switch), or manually when you raise it.
- The release runs ARMED -> PENDING -> GRACE -> RELEASED, every transition a
  strongly-consistent compare-and-set on Amazon Aurora DSQL, so it can never
  double-release.
- A trusted verifier (N-of-M) confirms, the recipient gets a prioritized plan,
  and an item is decrypted right in the browser via AWS KMS.
- The owner recovers, checks in, and the access closes automatically.
- Every step is written to an append-only, hash-chained audit log.

Built on Amazon Aurora DSQL (active-active, multi-region, strongly consistent) +
AWS KMS client-side envelope encryption + Next.js on Vercel.

Live app: https://relay-three-henna.vercel.app
Code: https://github.com/sgharlow/relay

Created for the H0 hackathon: Hack the Zero Stack with Vercel and AWS Databases.
#H0Hackathon

============================================================
TAGS  (comma-separated)
============================================================
Relay, Amazon Aurora DSQL, Aurora DSQL, AWS, AWS KMS, Vercel, Next.js, hackathon, H0Hackathon, digital estate, living continuity, encrypted vault, dead mans switch, zero knowledge, password manager, continuity

============================================================
SETTINGS
============================================================
- Visibility: PUBLIC (required for the bonus + so judges can view)
- Category: Science & Technology
- Audience: "No, it's not made for kids"
- Keep it under 3:00 (current cut is ~2:09)
