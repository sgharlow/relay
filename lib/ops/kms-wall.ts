/**
 * The wall underneath the other two, and the only one whose failure is
 * permanent.
 *
 * WHY THIS EXISTS. The least-privilege arc produced two re-measuring probes and
 * stopped one layer short. `verify:roles` reads what a database role may do once
 * connected; `verify:iam` reads whether the production principal can obtain an
 * admin connection at all. Both protect ACCESS to data that, if they fail,
 * still exists. Underneath them sits the customer master key, and every vault in
 * this product is ciphertext plus a data key wrapped by it.
 *
 * 🔴 THE FAILURE THIS WATCHES FOR IS NOT A BREACH, IT IS AN ERASURE. A CMK that
 * is disabled, scheduled for deletion, or whose key policy stops naming the
 * runtime principal does not leak anything — it makes every vault permanently
 * unreadable. `docs/backup-restore-runbook.md` covers the database, and a
 * restored cluster is ciphertext without the key that opens it, so the backup
 * that exists does not cover this. There is no rollback for a deleted key: AWS
 * offers a waiting period and nothing after it.
 *
 * And like both walls above it, none of that appears in a diff, a test run or a
 * build. One console click starts a deletion. The application keeps working for
 * the whole waiting period, because a key pending deletion still decrypts — so
 * the product looks healthy right up to the moment it is unrecoverable. That is
 * the precise shape this repository keeps catching: a green signal that is
 * measuring something other than the thing at risk.
 *
 * PURE, LIKE `iam-wall.ts`. No SDK call, no environment, no I/O — it takes the
 * shape AWS returns and produces a verdict, so every rule is testable against a
 * planted fixture and provable in a worktree with no credentials.
 * `scripts/verify-kms.ts` is the thin shell that fetches the real thing.
 *
 * ⚠️ IT ASSERTS THE POSITIVE HALF TOO. A key policy that grants nobody is not a
 * secure key, it is a dead product — `verify-iam.ts` states this rule in its own
 * words ("a check that is happiest when the product is broken is measuring the
 * wrong thing") and it applies here with more force, because the broken state
 * looks identical to the safe one from the outside.
 *
 * Feature: relay-h0-mvp
 * Requirements: 2.2, 2.4, 17.4
 */

/** `DescribeKey` → `KeyMetadata`, narrowed to the fields a verdict depends on. */
export interface KeyMetadata {
  KeyId?: string;
  /** Full key ARN. The script reads the account id out of it — see `verify-kms.ts`. */
  Arn?: string;
  Enabled?: boolean;
  /** Enabled | Disabled | PendingDeletion | PendingImport | Unavailable | Creating */
  KeyState?: string;
  KeyManager?: string;
  KeySpec?: string;
  KeyUsage?: string;
  MultiRegion?: boolean;
  /** Present only while a deletion is scheduled. Its presence IS the alarm. */
  DeletionDate?: Date | string;
}

/** One statement of a KMS key policy. Same shape as an IAM policy statement. */
export interface KeyPolicyStatement {
  Sid?: string;
  Effect?: string;
  Principal?: { AWS?: string | string[] } | string;
  Action?: string | string[];
  Resource?: string | string[];
}

export interface KeyPolicyDocument {
  Version?: string;
  Statement?: KeyPolicyStatement[];
}

/** Everything a verdict is read from. One object so the script does the I/O. */
export interface KeyFacts {
  metadata: KeyMetadata | undefined;
  policy: KeyPolicyDocument | undefined;
  /** `GetKeyRotationStatus` → `KeyRotationEnabled`. Undefined if unreadable. */
  rotationEnabled: boolean | undefined;
  /** The principal the live site authenticates as, e.g. an IAM user ARN. */
  runtimePrincipal: string;
}

export interface KeyWallVerdict {
  ok: boolean;
  /** Every reason the key is not in the state this product needs. */
  failures: string[];
  /** Non-fatal observations worth printing — never a reason to exit non-zero. */
  notes: string[];
  reason: string;
}

/**
 * The two operations envelope encryption cannot survive without.
 *
 * `GenerateDataKey` wraps a new item; `Decrypt` unwraps a stored one. A policy
 * that grants one and not the other is a product that can either write vaults
 * it can never read, or read vaults it can never add to — both broken, both
 * silent until somebody tries.
 */
const REQUIRED_ACTIONS = ['kms:generatedatakey', 'kms:decrypt'];

/**
 * What this repository intends automatic key rotation to be.
 *
 * ⚠️ THIS RECORDS THE AS-PROVISIONED STATE, NOT A RECOMMENDATION, and the
 * distinction is the whole reason it is a named constant rather than a literal.
 * `docs/aws-setup.md` creates the CMK with `aws kms create-key`, which leaves
 * automatic rotation DISABLED, and no decision to change that has ever been
 * recorded anywhere in this repo. So `false` is what the key almost certainly
 * is, and pinning it here means a SILENT change in either direction is caught —
 * which is the job of a wall check. It is not an assertion that off is right.
 *
 * Turning rotation on is defensible and cheap: for a symmetric CMK, AWS retains
 * the old key material, so every data key wrapped before a rotation keeps
 * decrypting afterwards and no re-wrap is needed. It is also an infrastructure
 * change to a working system. If it is taken, flip this constant IN THE SAME
 * COMMIT — a wall that records an intention nobody holds any more is worse than
 * no wall, because the next reader trusts it.
 *
 * If the first live run fails on this, that is itself the finding: somebody
 * changed rotation and nothing wrote it down.
 */
export const ROTATION_INTENDED = false;

function asArray(v: string | string[] | undefined): string[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

/** Same wildcard semantics as `iam-wall.ts` — `kms:*` and `*` confer without naming. */
function confers(action: string, target: string): boolean {
  if (action === '*') return true;
  if (action === target) return true;
  if (action.endsWith('*')) return target.startsWith(action.slice(0, -1));
  return false;
}

function principalsOf(s: KeyPolicyStatement): string[] {
  if (typeof s.Principal === 'string') return [s.Principal];
  return asArray(s.Principal?.AWS);
}

/**
 * Does this statement grant `principal` the action?
 *
 * An account-root principal (`arn:aws:iam::123456789012:root`) grants the whole
 * account, which is how KMS key policies normally delegate to IAM — so a
 * runtime user ARN in the same account IS covered by it. Treating root as a
 * miss would make this check fail on the ordinary, correct configuration, and a
 * check that cries wolf on the default gets switched off.
 */
function grants(s: KeyPolicyStatement, principal: string, action: string): boolean {
  if ((s.Effect ?? 'Allow') !== 'Allow') return false;
  if (!asArray(s.Action).some((a) => confers(String(a).toLowerCase(), action))) return false;

  const accountOf = (arn: string): string | null => arn.split(':')[4] ?? null;
  const wanted = accountOf(principal);

  return principalsOf(s).some((p) => {
    if (p === '*') return true;
    if (p === principal) return true;
    if (p.endsWith(':root') && wanted !== null && accountOf(p) === wanted) return true;
    return false;
  });
}

/**
 * Reads the key wall off what AWS actually returned.
 *
 * @param expectRotation what this repo intends rotation to be. Recorded as an
 *   INTENTION rather than assumed, because both answers are defensible for a
 *   symmetric CMK — rotation is backwards compatible, so old data keys keep
 *   decrypting under retained material — and the state worth alarming on is
 *   nobody knowing which was chosen.
 */
export function readKeyWall(facts: KeyFacts, expectRotation: boolean): KeyWallVerdict {
  const failures: string[] = [];
  const notes: string[] = [];

  const md = facts.metadata;

  if (!md || !md.KeyId) {
    return {
      ok: false,
      failures: ['the CMK could not be read at all'],
      notes,
      reason:
        'KMS returned no metadata for the configured key. Either KMS_KEY_ID names something ' +
        'that no longer exists, or the identity running this cannot read it. Both are findings: ' +
        'every vault in the product is ciphertext plus a data key wrapped by that CMK.',
    };
  }

  // Deletion first: it is the only finding with a deadline attached.
  if (md.DeletionDate !== undefined || md.KeyState === 'PendingDeletion') {
    const when = md.DeletionDate ? new Date(md.DeletionDate).toISOString() : 'unknown date';
    failures.push(`the key is SCHEDULED FOR DELETION (${when}) — cancel it now`);
  }

  if (md.KeyState !== undefined && md.KeyState !== 'Enabled' && md.KeyState !== 'PendingDeletion') {
    failures.push(`key state is ${md.KeyState}, not Enabled`);
  }

  if (md.Enabled === false && md.KeyState !== 'PendingDeletion') {
    failures.push('the key is disabled — every wrap and unwrap fails while it stays that way');
  }

  const statements = facts.policy?.Statement;
  if (!facts.policy || statements === undefined) {
    failures.push('the key policy could not be read');
  } else {
    const missing = REQUIRED_ACTIONS.filter(
      (action) => !statements.some((s) => grants(s, facts.runtimePrincipal, action)),
    );
    if (missing.length) {
      failures.push(
        `the key policy no longer lets ${facts.runtimePrincipal} ${missing.join(' or ')} — ` +
          'the live site cannot use the key it stores everything under',
      );
    }

    /*
      The positive half, and the one that catches the mistake nobody expects:
      a policy stripped to nothing is not a hardened key, it is an outage that
      has not happened yet. Reported as a failure rather than a note because
      passing here would mean this check is happiest when the product is dead.
    */
    const anyAllow = statements.some((s) => (s.Effect ?? 'Allow') === 'Allow');
    if (!anyAllow) {
      failures.push('the key policy grants nobody anything — that is broken, not secure');
    }
  }

  if (facts.rotationEnabled === undefined) {
    notes.push('rotation status unreadable (kms:GetKeyRotationStatus denied?)');
  } else if (facts.rotationEnabled !== expectRotation) {
    failures.push(
      `key rotation is ${facts.rotationEnabled ? 'ON' : 'OFF'} and this repo intends it ` +
        `${expectRotation ? 'ON' : 'OFF'}. Change one or the other deliberately — an unrecorded ` +
        'answer here is the finding, not the setting itself.',
    );
  }

  /*
    Not a failure, and the reason it is worth printing every run: the DATA path
    fails over between regions on an env switch (DSQL_USE_SECONDARY) and the
    CRYPTO path does not move with it. A single-Region CMK means a regional KMS
    impairment makes every vault unreadable from BOTH regions. Recorded as a
    note because the fix is an infrastructure change and Steve's call, and
    because a check that fails on a knowingly-accepted limitation is a check
    somebody disables.
  */
  if (md.MultiRegion === false || md.MultiRegion === undefined) {
    notes.push(
      'single-Region CMK: DSQL fails over between regions and this key does not move with it. ' +
        'Known and accepted — see PROJECT.yaml deferred B3.',
    );
  }

  if (failures.length) {
    return {
      ok: false,
      failures,
      notes,
      reason:
        `${failures.length} finding(s) against the key every vault depends on: ` +
        `${failures.join('; ')}. Ciphertext without this CMK is unrecoverable — there is no ` +
        'restore for it, and the product keeps working right up until it does not.',
    };
  }

  return {
    ok: true,
    failures,
    notes,
    reason:
      `CMK ${md.KeyId} is Enabled, not pending deletion, rotation as intended, and its policy ` +
      `still lets ${facts.runtimePrincipal} wrap and unwrap — the key wall holds`,
  };
}
