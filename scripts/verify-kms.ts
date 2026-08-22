/**
 * scripts/verify-kms.ts — is the key every vault depends on still there, still
 * usable, and still usable by us?
 *
 *   npx tsx --env-file=.env.admin scripts/verify-kms.ts     (npm run verify:kms)
 *
 * WHY THIS EXISTS. The least-privilege arc produced two re-measuring probes and
 * stopped one layer short. `verify:roles` reads what a database role may do once
 * connected. `verify:iam` reads whether the production principal can obtain an
 * admin connection at all. Both protect ACCESS to data that, if they fail, still
 * exists. Underneath both sits the customer master key, and every vault in this
 * product is ciphertext plus a data key wrapped by it.
 *
 * 🔴 THE FAILURE HERE IS AN ERASURE, NOT A BREACH, AND IT HAS NO ROLLBACK. A
 * disabled key, a scheduled deletion, or a key policy that stops naming the
 * runtime principal leaks nothing and makes every vault permanently unreadable.
 * `docs/backup-restore-runbook.md` covers the database; a restored cluster is
 * ciphertext without the key that opens it, so the backup does not cover this.
 * AWS offers a waiting period on deletion and nothing after it.
 *
 * AND THE PRODUCT LOOKS FINE THE WHOLE TIME. A key pending deletion still
 * decrypts, so every health check, every canary and every page stays green for
 * the entire waiting period and then the data is gone. That is the exact shape
 * this repository keeps catching — a green signal measuring something other
 * than the thing at risk — and it is why the check is a scheduled re-measurement
 * rather than a note asking somebody to look.
 *
 * READ-ONLY. Three calls and nothing else: DescribeKey, GetKeyPolicy,
 * GetKeyRotationStatus. It creates nothing, changes nothing, and is safe against
 * production, which is the only account worth running it against.
 *
 * ⚠️ IT NEEDS AN IDENTITY THAT CAN READ KMS METADATA. `kms:DescribeKey` and
 * `kms:GetKeyPolicy` are deliberately NOT what the application holds — the
 * runtime needs GenerateDataKey and Decrypt and nothing more. Run it with
 * `.env.admin`, whose whole design is that being a sysadmin is something you
 * choose by naming the file.
 *
 * NOT IN CI: CI has no AWS credentials, the same reason verify:schema,
 * verify:roles, verify:iam and verify:live are not.
 *
 * ⚠️ RUN IT ONCE AGAINST A DELIBERATE NEGATIVE. Every rule is unit-proven
 * against planted fixtures in lib/ops/kms-wall.test.ts, but the WIRING here —
 * that the right key is read, that a refusal exits non-zero — is only proven by
 * seeing it fail. Point KMS_KEY_ID at a key that does not exist and confirm this
 * exits 1. A wall checker that has only ever been seen to pass has not been seen
 * to work; verify:iam keeps policy v1 as a live negative control for the same
 * reason.
 *
 * Feature: relay-h0-mvp
 * Requirements: 2.2, 2.4, 17.4
 */

import {
  KMSClient,
  DescribeKeyCommand,
  GetKeyPolicyCommand,
  GetKeyRotationStatusCommand,
} from '@aws-sdk/client-kms';

import {
  readKeyWall,
  ROTATION_INTENDED,
  type KeyFacts,
  type KeyMetadata,
  type KeyPolicyDocument,
} from '../lib/ops/kms-wall';

/** The IAM user Vercel authenticates as — same default as verify:iam. */
const RUNTIME_USER = process.env.RELAY_RUNTIME_IAM_USER ?? 'relay-runtime';

/**
 * The account the key lives in, read out of the key's own ARN.
 *
 * Deliberately not an STS call: `@aws-sdk/client-sts` is not a dependency here,
 * and adding one to learn a number that is already in the response would be a
 * dependency bought for nothing.
 */
function accountFromArn(arn: string | undefined): string | null {
  return arn?.split(':')[4] ?? null;
}

async function main(): Promise<void> {
  const keyId = process.env.KMS_KEY_ID;
  if (!keyId) {
    /*
      🔴 THIS FIRED ON THE SCRIPT'S OWN DECLARED INVOCATION, 2026-08-21.
      `npm run verify:kms` runs `--env-file=.env.admin`, and that file held the
      DSQL endpoints and `AWS_PROFILE` but never `KMS_KEY_ID` — so the one check
      in this repo whose failure is PERMANENT and unrecoverable was the one check
      that could not run the way it is documented. It failed CLOSED (exit 1), so
      it was never a false green; it was simply never going to answer. CLAUDE.md
      meanwhile recorded it as live-proven on 2026-08-20, which it was — by
      somebody supplying the key by hand, which is not what the command does.

      The message now names the fix rather than the symptom. A refusal that does
      not say what to do is a refusal somebody routes around.
    */
    console.error('[kms] ✗ KMS_KEY_ID is not set, so there is nothing to check.');
    console.error('');
    console.error('      This needs BOTH admin AWS credentials (for DescribeKey and');
    console.error('      GetKeyPolicy) AND the key id. `.env.admin` carries the credentials;');
    console.error('      make sure it carries the key id too — it is an identifier, not a');
    console.error('      secret, and it already appears in .env.local:');
    console.error('');
    console.error('        grep ^KMS_KEY_ID= .env.local >> .env.admin');
    console.error('');
    process.exit(1);
  }

  const region = process.env.AWS_REGION ?? 'us-east-1';
  const kms = new KMSClient({ region });

  console.log(`[kms] key ${keyId} in ${region} — read-only\n`);

  let metadata: KeyMetadata | undefined;
  try {
    const described = await kms.send(new DescribeKeyCommand({ KeyId: keyId }));
    metadata = described.KeyMetadata as KeyMetadata | undefined;
  } catch (err) {
    /*
      A NotFound here is the finding, not an error to report as a crash — it is
      indistinguishable from "somebody deleted the key" and must exit non-zero
      with an explanation rather than a stack trace.
    */
    console.error(`[kms] ✗ could not describe the key: ${String(err)}`);
    console.error(
      '[kms]   Either KMS_KEY_ID names something that no longer exists, or this identity ' +
        'cannot read it. Both are findings.',
    );
    process.exit(1);
  }

  let policy: KeyPolicyDocument | undefined;
  try {
    const got = await kms.send(new GetKeyPolicyCommand({ KeyId: keyId, PolicyName: 'default' }));
    policy = got.Policy ? (JSON.parse(got.Policy) as KeyPolicyDocument) : undefined;
  } catch (err) {
    console.error(`[kms]   key policy unreadable: ${String(err)}`);
  }

  let rotationEnabled: boolean | undefined;
  try {
    const rot = await kms.send(new GetKeyRotationStatusCommand({ KeyId: keyId }));
    rotationEnabled = rot.KeyRotationEnabled;
  } catch {
    // Left undefined — the wall reports it as a note, never as a failure.
  }

  const account = accountFromArn(metadata?.Arn);
  const runtimePrincipal = account
    ? `arn:aws:iam::${account}:user/${RUNTIME_USER}`
    : RUNTIME_USER;

  const facts: KeyFacts = { metadata, policy, rotationEnabled, runtimePrincipal };
  const verdict = readKeyWall(facts, ROTATION_INTENDED);

  console.log(`  state          ${metadata?.KeyState ?? 'unknown'}`);
  console.log(`  manager        ${metadata?.KeyManager ?? 'unknown'}`);
  console.log(`  spec           ${metadata?.KeySpec ?? 'unknown'}`);
  console.log(`  multi-Region   ${metadata?.MultiRegion === true ? 'yes' : 'no'}`);
  console.log(
    `  rotation       ${rotationEnabled === undefined ? 'unreadable' : rotationEnabled ? 'on' : 'off'}` +
      `  (this repo intends: ${ROTATION_INTENDED ? 'on' : 'off'})`,
  );
  console.log(`  runtime        ${runtimePrincipal}\n`);

  for (const note of verdict.notes) console.log(`  note: ${note}`);
  if (verdict.notes.length) console.log('');

  if (!verdict.ok) {
    for (const f of verdict.failures) console.error(`[kms] ✗ ${f}`);
    console.error(`\n[kms] ✗ ${verdict.reason}`);
    process.exit(1);
  }

  console.log(`[kms] ✓ ${verdict.reason}`);
}

main().catch((err) => {
  console.error('[kms] ✗ unexpected failure:', err);
  process.exit(1);
});
