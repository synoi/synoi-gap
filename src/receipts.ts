/**
 * receipts.ts -- GAP Decision Receipts.
 *
 * Every gate decision (capability invocation, workflow transition, grant
 * issuance/revocation, federation handshake (reserved for GAP 1.1), provisional block) produces
 * an immutable Decision Receipt. These are the audit trail of the agent
 * platform -- what was allowed, what was denied, when, and by whom.
 *
 * Mirrors GAP_SPEC §8.
 */

import type { GapCdroEnvelope } from './cdro.js'
import type { GapActorType } from './capabilities.js'

export type DecisionSubjectKind =
  | 'capability_invocation'
  | 'stage_transition'
  | 'grant_issued'
  | 'grant_revoked'
  | 'workflow_started'
  | 'workflow_terminated'
  | 'revocation_initiated'
  | 'revocation_effective'
  | 'federation_handshake' // reserved for GAP 1.1 - not part of the active 1.0 conformance surface
  | 'provisional_block'

export type DecisionStatus =
  | 'ok'
  | 'denied'
  | 'failed'
  | 'deferred'
  | 'timed_out'
  | 'pending'
  | 'rate_limited'

export interface GapDecisionReceiptBody {
  subject_kind: DecisionSubjectKind
  subject_oid: string
  initiator: {
    actor_oid: string
    actor_type: GapActorType
  }
  status: DecisionStatus
  detail?: string
  capability_grant_oids?: string[]
  workflow_instance_oid?: string
  workflow_stage_id?: string
  inference_receipt_oid?: string
  channel_event_oids?: string[]
  initiated_at_ms: number
  resolved_at_ms: number
  metrics?: {
    latency_ms?: number
    channel_count?: number
    listen_match_count?: number
  }
  compliance_tags?: string[]
  /**
   * True when this receipt was served from the idempotency deduplication cache
   * rather than freshly evaluated. The cached args and grant state at the time
   * of original evaluation apply; this is NOT a fresh gate decision.
   */
  is_idempotency_replay?: boolean
  /**
   * The client-supplied `invoked_at_ms` value from the invocation body,
   * preserved here for debugging only. MUST NOT be used as `initiated_at_ms`.
   * The gateway always server-stamps `initiated_at_ms`.
   */
  client_claimed_at_ms?: number
  /**
   * For receipts covering physical_safety=true capabilities: constrained
   * devices performing offline Ed25519 signature verification MUST NOT accept
   * this receipt after this TTL has elapsed (milliseconds since epoch).
   * Absent means no offline TTL is enforced by the protocol (gateway-level
   * policy may still apply).
   */
  max_offline_ttl_ms?: number
  /**
   * For 21 CFR Part 11 contexts: display name, role, and credential identifier
   * of the authorizing human. The `granted_by` actor OID SHOULD resolve to
   * this identity. Gateway-populated when the deployment asserts 21 CFR Part 11
   * compliance and the receipt covers a medical device / clinical capability.
   */
  signer_identity?: {
    display_name: string
    role?: string
    credential_id?: string
  }
  /**
   * C8: Sub-millisecond sequence numbers (GAP spec section Phase 4).
   *
   * Monotonically increasing integer within the tenant, incremented per receipt,
   * gapless. Gaps in the sequence indicate dropped receipts. Provides
   * determinable ordering within a millisecond for high-frequency deployments
   * (MiFID II RTS 25). A gateway MUST guarantee strict monotonicity within a
   * tenant.
   */
  sequence_number?: number
  /**
   * C8: Optional nanoseconds since Unix epoch for sub-millisecond precision.
   * RECOMMENDED for financial.* capabilities. Complements decided_at_ms
   * (the spec's alias for resolved_at_ms) when nanosecond ordering matters.
   */
  decided_at_ns?: number
  /**
   * Item 3 [DESIGN]: Settled token consumption for this invocation. Populated
   * by the gateway post-invoke when the 'token_budget' precondition is active.
   * input_tokens and output_tokens MUST be non-negative integers.
   */
  token_consumption?: TokenConsumption
}

// -- Item 3: Token Consumption -----------------------------------------------

/**
 * [DESIGN] Actual token usage settled onto the receipt by the gateway after
 * execution. Used by the 'token_budget' precondition (post_invoke evaluation).
 * Any cost_usd figures are [MODELED] until a conformance vector exists.
 */
export interface TokenConsumption {
  /** Input (prompt) tokens consumed. Must be a non-negative integer. */
  input_tokens: number
  /** Output (completion) tokens consumed. Must be a non-negative integer. */
  output_tokens: number
  /** Model identifier that produced the tokens. */
  model: string
  /** Estimated cost in USD. [MODELED] -- not authoritative until conformance vector exists. */
  cost_usd?: number
  /** Unix epoch ms when consumption was settled. */
  settled_at_ms: number
}

export type GapDecisionReceipt = GapCdroEnvelope<GapDecisionReceiptBody>

// -- Failure typing (non-CDRO; in-process return shape) ----------------------

/**
 * In-process failure classification returned by gate helpers and SDK utilities.
 * This is an internal enum and does NOT appear on the wire.
 *
 * The wire `detail` field in `GapDecisionReceipt.body.detail` uses the
 * namespaced error codes from ERROR_CODES.md, for example:
 *   capability_denied:no_grant
 *   capability_denied:grant_expired
 *   capability_denied:grant_revoked
 *   capability_denied:rate_limited
 * Do NOT expose GapFailureReason values in serialized receipts or HTTP responses.
 */
export type GapFailureReason =
  | 'capability_not_found'
  | 'capability_denied'
  | 'capability_revoked'
  | 'precondition_failed'
  | 'rate_limited'
  | 'grant_expired'
  | 'workflow_not_found'
  | 'workflow_revoked'
  | 'missing_required_channels'
  | 'execution_failed'

export interface GapFailure {
  reason: GapFailureReason
  detail?: string
  receipt_oid: string
}

export function isGapFailure<T>(r: T | GapFailure): r is GapFailure {
  return typeof r === 'object' && r !== null && 'reason' in (r as Record<string, unknown>)
}
