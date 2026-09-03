/**
 * POST /api/kms/wrap — KMS proxy: generate a fresh wrapped data key.
 *
 * Authenticated Owner session required. Calls KMS GenerateDataKey(AES_256) and
 * returns BOTH the plaintext data key (for the browser's in-memory AES-GCM
 * encrypt) and its wrapped form (for storage). The plaintext key is returned to
 * the browser over TLS but is NEVER logged. Writes an audit entry
 * `kms_wrap_requested` (no key material in the audit detail).
 *
 * Feature: relay-h0-mvp
 * Requirements: 2.2, 17.4
 */

import { NextResponse } from 'next/server';
import { getOwnerSession } from '../../../../../lib/auth/session';
import { generateDataKey, wrapsWithContext } from '../../../../../lib/kms/kms-client';
import { writeAuditEntry } from '../../../../../lib/audit/audit-service';

/*
  One line per process, not per request. The flag is a deployment-wide
  misconfiguration, so an operator needs to be told once — repeating it on every
  vault write buries the signal in the noise it creates. Never reset: a warm
  function instance has already said it.
*/
let warnedIgnoredWrapFlag = false;

export async function POST(): Promise<NextResponse> {
  // Owner auth — getOwnerSession throws a 401 NextResponse when unauthenticated.
  let ownerId: string;
  try {
    ({ ownerId } = await getOwnerSession());
  } catch (res) {
    return res as NextResponse;
  }

  /*
    PHASE B READS THE FLAG AND DELIBERATELY DOES NOT ACT ON IT.

    docs/encryption-context-rollout.md makes KMS_WRAP_WITH_CONTEXT phase C's
    switch for wrapping with { owner_id } AND stamping 'owner_v1' — one change,
    because a data key wrapped with a context that nothing stamps could never be
    unwrapped again. This build has neither half, so the flag is inert here and
    that is safe by design: no context is wrapped, nothing is stamped, and every
    row stays openable by every build. Refusing the request instead would turn a
    harmless misconfiguration into an outage on every vault write.

    It is not silently inert, though. One line to stderr, because a flag that is
    ignored without saying so is how a phase C flip gets recorded as done having
    changed nothing.

    Phase C replaces this block with the wrap-and-stamp path.
  */
  if (wrapsWithContext() && !warnedIgnoredWrapFlag) {
    warnedIgnoredWrapFlag = true;
    console.warn(
      '[kms] KMS_WRAP_WITH_CONTEXT is on but this build does not stamp an era — ' +
        'ignored; wrapping without context',
    );
  }

  let key;
  try {
    key = await generateDataKey();
  } catch {
    // Do not leak KMS internals to the client.
    return NextResponse.json(
      { error: 'KMSError', message: 'Failed to generate data key' },
      { status: 502 },
    );
  }

  // Audit the request — never record the plaintext or wrapped key bytes.
  await writeAuditEntry(ownerId, {
    actor: `owner:${ownerId}`,
    action: 'kms_wrap_requested',
    entity: 'kms',
    detail: { kms_key_id: key.kmsKeyId },
  });

  return NextResponse.json({
    plaintext_data_key: key.plaintextDataKey,
    wrapped_data_key: key.wrappedDataKey,
    kms_key_id: key.kmsKeyId,
  });
}
