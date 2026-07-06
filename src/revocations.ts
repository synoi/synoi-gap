/**
 * revocations.ts -- RevocationEvent CDRO.
 *
 * Revocation in GAP is leveled (L1 / L2 / L3) per GAP_SPEC §7. V1 gateway
 * scope is L1 only; L2/L3 fields are tracked here for forward compatibility.
 *
 * Targets include declarations, grants, workflow definitions, workflow
 * instances, and whole skills. A revocation can be provisional (immediately
 * blocks but pending finalization) or final.
 */

import type { GapCdroEnvelope } from './cdro.js'

export type RevocationTargetKind =
  | 'capability_declaration'
  | 'capability_grant'
  | 'workflow_definition'
  | 'workflow_instance'
  | 'skill'

export interface RevocationEventBody {
  target_kind: RevocationTargetKind
  target_oid: string
  reason: string
  evidence_oids?: string[]
  required_level: 1 | 2 | 3
  provisional: boolean
  approvers: Array<{
    actor_oid: string
    approved_at_ms: number
    cooling_off_satisfied: boolean
    attestation_oid?: string
  }>
  public_notice_started_at_ms?: number
  public_notice_window_ms?: number
  effective_at_ms: number | null
  lifted_at_ms?: number | null
  /**
   * Controls what happens when a provisional block's TTL expires without the
   * required L3 quorum completing:
   *   'renew'  -- the block auto-renews (fail-closed). Default, and MUST be
   *               the behavior when any targeted grant covers a capability
   *               with physical_safety=true or safety_class='C'.
   *   'revert' -- the block expires and the target is re-enabled. Only
   *               permissible for safety_class A/B capabilities with explicit
   *               operator override.
   *
   * Absent defaults to 'renew' for physical safety targets, 'revert' for
   * others (legacy behavior). Gateways MUST treat absent-for-physical-safety
   * as 'renew'.
   */
  provisional_block_policy?: {
    on_expiry_without_quorum: 'renew' | 'revert'
    /**
     * M-5: Operator override for the provisional block TTL. Defaults to 72
     * hours (259_200_000 ms). Minimum: 1 hour (3_600_000 ms). For
     * safety_class C capabilities with on_expiry_without_quorum='renew', the
     * renewal cycle period equals this value.
     */
    provisional_block_ttl_ms?: number
  }
  /**
   * Minimum number of distinct approvers required to make `effective_at_ms`
   * non-null. Default: 1 for L2, gateway-configured for L3 (recommended >= 2).
   * The gateway MUST reject a duplicate approval from the same actor_oid.
   * Self-approval (approver actor_oid === revocation event created_by) MUST
   * be rejected.
   */
  min_approvers?: number
}

export type RevocationEvent = GapCdroEnvelope<RevocationEventBody>

export function revokeGapObject(
  target_kind: RevocationTargetKind,
  target_oid: string,
  reason: string,
  required_level: 1 | 2 | 3,
  provisional: boolean,
): RevocationEventBody {
  return {
    target_kind,
    target_oid,
    reason,
    required_level,
    provisional,
    approvers: [],
    effective_at_ms: null,
  }
}
