/**
 * Tests for delegate scope enforcement.
 *
 * Every assertion here is a security boundary. A delegate must not decrypt
 * items they did not enter, must not touch triggers, and must not self-grant.
 * Client-side scope hiding is not enforcement (J3-R11).
 *
 * Feature: relay-caregiver
 * Requirements: J3-R4, J3-R5, J3-R6, J3-R11
 */

import { describe, it, expect } from 'vitest';
import { requireScope, assertDelegateMayRead, type ActorContext } from './delegate-route';
import { IntegrityError } from '../db/integrity';
import { DELEGATE_SCOPES } from '../people/delegation';

function ownerCtx(): ActorContext {
  return {
    ownerId: 'o-1',
    actingUserId: 'o-1',
    isDelegate: false,
    delegationId: null,
    scopes: [],
  };
}

function delegateCtx(scopes: ActorContext['scopes'] = ['items:create']): ActorContext {
  return {
    ownerId: 'o-1',
    actingUserId: 'u-2',
    isDelegate: true,
    delegationId: 'd-1',
    scopes,
  };
}

describe('requireScope', () => {
  it('always allows the owner, whatever the scope', () => {
    for (const s of DELEGATE_SCOPES) {
      expect(() => requireScope(ownerCtx(), s)).not.toThrow();
    }
  });

  it('allows a delegate holding the scope', () => {
    expect(() => requireScope(delegateCtx(['items:create']), 'items:create')).not.toThrow();
  });

  it('REJECTS a delegate missing the scope', () => {
    expect(() => requireScope(delegateCtx(['items:create']), 'import:run')).toThrow(IntegrityError);
  });

  it('REJECTS a delegate with no scopes at all', () => {
    expect(() => requireScope(delegateCtx([]), 'items:create')).toThrow(IntegrityError);
  });

  it('rejects every scope a delegate does not hold', () => {
    const ctx = delegateCtx(['items:create']);
    for (const s of DELEGATE_SCOPES.filter((x) => x !== 'items:create')) {
      expect(() => requireScope(ctx, s)).toThrow(IntegrityError);
    }
  });
});

describe('assertDelegateMayRead', () => {
  it('lets the owner read anything, however it was entered', () => {
    expect(() => assertDelegateMayRead(ownerCtx(), { created_by_delegate_id: 'd-9' })).not.toThrow();
    expect(() => assertDelegateMayRead(ownerCtx(), { created_by_delegate_id: null })).not.toThrow();
  });

  it('lets a delegate read an item they personally entered', () => {
    expect(() => assertDelegateMayRead(delegateCtx(), { created_by_delegate_id: 'd-1' })).not.toThrow();
  });

  it('REJECTS a delegate reading an item the OWNER entered', () => {
    expect(() => assertDelegateMayRead(delegateCtx(), { created_by_delegate_id: null })).toThrow(
      IntegrityError,
    );
  });

  it('REJECTS a delegate reading an item ANOTHER delegate entered', () => {
    expect(() => assertDelegateMayRead(delegateCtx(), { created_by_delegate_id: 'd-2' })).toThrow(
      IntegrityError,
    );
  });

  it('fails closed when provenance is missing from the row', () => {
    expect(() => assertDelegateMayRead(delegateCtx(), {} as never)).toThrow(IntegrityError);
  });
});
