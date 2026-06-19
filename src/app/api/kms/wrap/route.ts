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
import { generateDataKey } from '../../../../../lib/kms/kms-client';
import { writeAuditEntry } from '../../../../../lib/audit/audit-service';

export async function POST(): Promise<NextResponse> {
  // Owner auth — getOwnerSession throws a 401 NextResponse when unauthenticated.
  let ownerId: string;
  try {
    ({ ownerId } = await getOwnerSession());
  } catch (res) {
    return res as NextResponse;
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
