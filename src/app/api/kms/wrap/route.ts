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

export async function POST(): Promise<NextResponse> {
  // Owner auth — getOwnerSession throws a 401 NextResponse when unauthenticated.
  let ownerId: string;
  try {
    ({ ownerId } = await getOwnerSession());
  } catch (res) {
    return res as NextResponse;
  }

  /*
    PHASE B READS THE FLAG AND REFUSES TO ACT ON IT.

    docs/encryption-context-rollout.md phase C flips KMS_WRAP_WITH_CONTEXT so
    new wraps carry { owner_id } AND the row is stamped 'owner_v1'. Those are
    one change, not two: a data key wrapped with a context that nothing stamps
    can never be unwrapped again, because no row records which context it
    needs. That is the intact-and-unreachable state the rollout document exists
    to prevent, and it is the one failure in this product with no recovery.

    This build reads the era and cannot stamp it, so an ON flag here is a
    misconfiguration and not an early phase C. It is refused rather than
    honoured or ignored: honouring it strands rows, and ignoring it would let
    the flip be recorded as done while nothing changed.

    Phase C deletes this block in the same change that adds the stamping.
  */
  if (wrapsWithContext()) {
    return NextResponse.json(
      {
        error: 'KMSError',
        message: 'Wrapping with an encryption context is not available in this build',
      },
      { status: 503 },
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
