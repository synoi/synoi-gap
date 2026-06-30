/**
 * capabilities.ts -- Declaration / Grant / Invocation shapes.
 *
 * These mirror the GAP gateway reference implementation wire types.
 * The trio is the GAP operational core:
 *
 *   - CapabilityDeclaration: an actor announces "I can do X under conditions Y".
 *   - CapabilityGrant:        an operator says "actor A may invoke X within scope S until time T".
 *   - CapabilityInvocation:   an actor performs "I am invoking X, here are my args + the grant I'm using".
 *
 * Every gate check (grant exists + not revoked + not expired + scope matches
 * + preconditions hold) happens on invocation. The decision becomes a
 * GapDecisionReceipt.
 */

import type { GapCdroEnvelope } from './cdro.js'

// -- Actor taxonomy -----------------------------------------------------------

export type GapActorType =
  | 'skill'
  | 'service'
  | 'device'
  | 'agent'
  | 'mcp_server'
  | 'gateway_subsystem'
  | 'human_user'

// -- Item 1: Agent Delegation Chain ------------------------------------------

/**
 * [DESIGN] One hop in a gap:orchestration_chain. Each step signs over the
 * prior step receipt OID plus the canonical invocation body. Signing keys for
 * each hop MUST be declared at grant issuance.
 */
export interface DelegationStep {
  /** Zero-based index of this hop in the chain. */
  step_index: number
  /** Actor OID performing the delegation. */
  delegator_actor_oid: string
  /** Actor OID receiving delegated authority. */
  delegatee_actor_oid: string
  /** OID of the grant that authorizes this delegation hop. */
  grant_oid: string
  /** OID of the receipt from the prior hop (absent for step_index 0). */
  prior_receipt_oid?: string
  /** Unix epoch ms when delegation was issued. */
  delegated_at_ms: number
  /** Signature over canonical(prior_receipt_oid + invocation_body), base64url. */
  step_signature: string
  /** Algorithm used for step_signature, e.g. 'Ed25519' or 'ML-DSA-65'. */
  step_signature_alg: string
}

/**
 * [DESIGN] Body of a gap:orchestration_chain CDRO. Consolidates all delegation
 * hops into one envelope. The gateway MUST verify each step's signature before
 * allowing the terminal invocation.
 *
 * Max hops: 10. Gateway returns HTTP 400 with error 'delegation_depth_exceeded'
 * when steps.length > 10.
 */
export interface OrchestrationChainBody {
  /** Actor OID that initiated the chain. */
  root_actor_oid: string
  /** Ordered array of delegation steps, max 10. */
  steps: DelegationStep[]
  /** Capability name being delegated through the chain. */
  capability_name: string
  /** OID of the terminal invocation CDRO this chain authorizes. */
  final_invocation_oid: string
}

// -- Item 2: MCP Tool-Call Governance ----------------------------------------

/**
 * [DESIGN] Context attached to an invocation when the capability originated
 * from an MCP tools/list response. Capability names for MCP tools follow the
 * pattern mcp.<server_id>.<tool_name>.
 *
 * The gateway MUST reject any auto-generated capability name that starts with
 * 'gap:' or matches any normative capability name, to prevent namespace
 * pollution from attacker-controlled tools/list responses.
 */
export interface McpToolCallContext {
  /** Stable identifier for the MCP server. */
  server_id: string
  /** Name of the tool as returned by tools/list. */
  tool_name: string
  /** Optional SHA-256 hash of the tool's JSON schema, for drift detection. */
  tool_schema_hash?: string
}

// -- Item 3: Token Budget Governance -----------------------------------------

/**
 * [DESIGN] Args for the 'token_budget' precondition kind. Evaluation timing:
 * post_invoke (settled after execution). Any cost figures MUST carry [MODELED]
 * tag until a conformance vector exists.
 */
export interface TokenBudgetArgs {
  /**
   * Model ID pattern using shell-glob syntax, e.g. 'anthropic/claude-*'.
   * Matched against the model identifier on the receipt's token_consumption.
   */
  model_scope: string
  /** Maximum input tokens permitted within window_seconds. */
  max_input_tokens?: number
  /** Maximum output tokens permitted within window_seconds. */
  max_output_tokens?: number
  /** Maximum cost in USD permitted within window_seconds. [MODELED] */
  max_cost_usd?: number
  /** Rolling window length in seconds. */
  window_seconds: number
}

// -- Item 4: Consent Version Chain -------------------------------------------

/**
 * [DESIGN] Body of a gap:consent_record CDRO. Forms an append-only chain via
 * prior_consent_oid. The precondition kind 'consent_current' evaluates whether
 * the actor's most recent consent record has consented: true.
 *
 * MUST: the gateway MUST NOT use the idempotency cache for consent_current
 * evaluation. Withdrawal (consented: false) MUST take effect within 5 seconds
 * across all replicas.
 *
 * This single primitive subsumes hiring consent, learner consent, and clinical
 * consent. The context field carries sector-specific detail.
 */
export interface ConsentRecordBody {
  /** Actor OID whose consent this record captures. */
  actor_oid: string
  /** Tenant scope of the consent. */
  tenant_id: string
  /**
   * Free-form context string identifying the consent subject, e.g.
   * 'hiring.background_check', 'clinical.data_sharing', 'learner.analytics'.
   */
  context: string
  /** True = consent granted; false = consent withdrawn. */
  consented: boolean
  /** OID of the prior consent record for this actor + context, forming the chain. */
  prior_consent_oid?: string
  /** Unix epoch ms when consent was recorded. */
  consented_at_ms: number
  /** Optional expiry; gateway MUST treat expired records as consented: false. */
  expires_at_ms?: number
  /** SHA-256 hash of the consent disclosure text shown to the actor. */
  consent_text_hash?: string
}

// -- Item 5: Identity Binding ------------------------------------------------

/**
 * [DESIGN] Normative credential_kind values for IdentityBinding. The binding
 * ties an actor_oid to a real-world credential with a hardware-backed signature.
 */
export type CredentialKind =
  | 'piv_cac'
  | 'x509'
  | 'fido2'
  | 'tpm_attestation'
  | 'oidc_sub'
  | 'spiffe_svid'
  | 'wallet_address'
  | 'professional_license'

/**
 * [DESIGN] Ties an actor_oid to a real-world credential. The canonical binding
 * payload (domain-separated) is:
 *   "gap-identity-binding-v1" + ":" + actor_oid + ":" + tenant_id + ":" + credential_identifier
 *
 * The binding_signature is a credential holder's signature over that payload.
 */
export interface IdentityBinding {
  /** Normative credential kind. */
  credential_kind: CredentialKind
  /** Stable identifier within the credential_kind namespace (e.g. certificate serial, SPIFFE SVID URI). */
  credential_identifier: string
  /** Signature over the domain-separated canonical payload, base64url. */
  binding_signature: string
  /** Algorithm used for binding_signature, e.g. 'Ed25519', 'ES256', 'RS256'. */
  binding_alg: string
  /** Unix epoch ms when binding was established. */
  bound_at_ms: number
  /** Issuer identifier (CA DN, OIDC issuer URL, etc.) -- optional but RECOMMENDED. */
  issuer?: string
  /** Unix epoch ms when binding expires. Absent = no expiry. */
  expires_at_ms?: number
}

// -- Item 7: Signed PIP Response ---------------------------------------------

/**
 * [DESIGN] Args for the 'external_pip' precondition kind. The gateway POSTs
 * invocation args to the endpoint and evaluates the boolean `allowed` response.
 * When pip_response_oid is set, the referenced gap:pip_response CDRO is
 * ENFORCING; the gateway MUST verify its signature before using it as the sole
 * basis for an allow decision. Unsigned reads without pip_response_oid are
 * ADVISORY only.
 */
export interface ExternalPipArgs {
  /** URL of the external Policy Information Point. */
  endpoint_url: string
  /** Cache TTL in seconds for the PIP response, keyed by (tenant, capability, args-hash). */
  cache_ttl_seconds: number
  /** Invocation arg keys sent to the PIP as subject context. */
  subject_fields: string[]
  /**
   * [DESIGN] OID of a gap:pip_response CDRO. When present, the gateway MUST
   * verify the CDRO signature before treating the response as ENFORCING.
   * Absent = response is ADVISORY.
   */
  pip_response_oid?: string
}

/**
 * [DESIGN] Body of a gap:pip_response CDRO. Emitted by an external PIP and
 * re-signed by the gateway. Distinction:
 *   - Unsigned external reads: ADVISORY (influence decision; cannot be sole basis for allow).
 *   - Signed gap:pip_response: ENFORCING (gateway may use as sole basis for allow/deny).
 *
 * The gateway MUST verify the CDRO signature before treating the response as
 * enforcing.
 */
export interface PipResponseBody {
  /** URL of the external PIP endpoint that produced this response. */
  pip_endpoint: string
  /** SHA-256 hash of the canonical request args sent to the PIP. */
  request_args_hash: string
  /** SHA-256 hash of the raw response body received from the PIP. */
  response_body_hash: string
  /** Optional human-readable summary of the PIP response (not authoritative). */
  response_summary?: string
  /** Unix epoch ms when the PIP was queried. */
  evaluated_at_ms: number
  /** How long (ms) this response may be cached by the gateway. */
  cache_ttl_ms: number
  /** Optional signature from the PIP itself over the response body, base64url. */
  pip_signature?: string
  /** Algorithm used for pip_signature. */
  pip_signature_alg?: string
}

// -- Predicates + capability shape --------------------------------------------

export interface CapabilityPredicate {
  kind: string
  args: Record<string, unknown>
}

export interface Capability {
  /** Dotted-taxonomy capability name, e.g. `skill.create`, `gap.discovery.query`. */
  capability: string
  /** Capability-level scope constraints (free-form per-capability). */
  scope?: Record<string, unknown>
  /** Preconditions evaluated at invocation gate. */
  preconditions?: CapabilityPredicate[]
  /** Safety classification: A (low) / B (medium) / C (high). */
  safety_class?: 'A' | 'B' | 'C'
  /** True if invocation can change physical-world state (HA, IoT, etc.). */
  physical_safety?: boolean
  /**
   * When true, the gateway MUST attach a cryptographic signature to every
   * decision receipt for this capability, regardless of the server's default
   * conformance tier. When false, the gateway SHOULD omit the signature even
   * on an L4 server (useful for high-frequency trivial actions where signing
   * cost outweighs the benefit). When absent, the gateway applies its
   * configured default signing policy.
   *
   * The operator may override this on the grant via
   * GrantedCapabilityScope.require_signed_receipt.
   */
  require_signed_receipt?: boolean
  /**
   * Array of invocation arg key strings whose values contain PII, PHI, or NPI
   * requiring tokenization before storage. The gateway MUST replace each listed
   * key's value with a keyed HMAC token (one-way, using a per-tenant key)
   * before constructing the invocation CDRO and receipt body. The original
   * value is used for capability execution by the adapter but MUST NOT be
   * stored in any CDRO.
   *
   * Required for capabilities with privacy_classification 'phi' or whose name
   * matches medical.* or financial.*.
   */
  pii_args?: string[]
  /**
   * C17: When true, the gateway routes receipts for this capability to a
   * privilege-isolated store, suppresses them from the standard GET /receipts
   * list endpoint, requires an explicit attorney-assertion header on fetch by
   * OID, and excludes the receipt from automated compliance exports.
   * Controls access routing, not deletion.
   */
  privilege_protected?: boolean
}

// -- Declaration --------------------------------------------------------------

export interface CapabilityDeclarationBody {
  actor_type: GapActorType
  actor_id: string
  actor_name: string
  actor_version: string
  source_url?: string
  parent_oid?: string
  capabilities: Capability[]
  /**
   * C15: Ephemeral actor lifecycle (GAP spec Phase 1 -- Ephemeral Actors).
   *
   * `persistent` (default) -- standard supersession uniqueness rules apply.
   * `ephemeral` -- declaration is exempt from supersession uniqueness; each
   * invocation gets a fresh OID valid for its session only.
   */
  actor_lifecycle?: 'persistent' | 'ephemeral'
  /**
   * C15: UUID or job ID distinguishing this instance from others with the same
   * actor_id. When present, two declarations with the same actor_id but
   * different actor_instance_id MUST NOT be treated as superseding each other.
   */
  actor_instance_id?: string
  /**
   * C15: For ephemeral actors: when this session ends (Unix epoch ms). The
   * gateway MUST auto-revoke all grants scoped to this actor_instance_id at
   * this time.
   */
  session_expires_at_ms?: number
  declared_limits?: {
    max_invocations_per_minute?: number
    max_concurrent_invocations?: number
    max_payload_bytes?: number
    requires_network?: boolean
    requires_filesystem_read?: string[]
    requires_filesystem_write?: string[]
  }
  human_summary?: string
  privacy_classification?: 'public' | 'restricted' | 'sensitive' | 'phi' | 'pii' | 'financial' | 'privileged'
  /**
   * Item 5 [DESIGN]: Real-world credential binding for this actor. Ties the
   * actor_oid to a verifiable credential using a hardware-backed signature.
   * See IdentityBinding for the canonical payload and domain-separation prefix.
   */
  identity_binding?: IdentityBinding
  /**
   * Item 6 [DESIGN]: Compartment label for this declaration.
   * Values: 'UNCLASS', 'CUI', or a reverse-domain operator label
   * (e.g. 'com.acme.project-alpha').
   */
  compartment?: string
}

export type CapabilityDeclaration = GapCdroEnvelope<CapabilityDeclarationBody>

// -- Grant --------------------------------------------------------------------

export interface GrantedCapabilityScope {
  capability: string
  /**
   * OID of the specific capability declaration envelope this scope is pinned to.
   * REQUIRED for grants covering safety_class='C' or physical_safety=true
   * capabilities. The gateway evaluates those grants against this pinned
   * declaration OID rather than the actor's current active declaration,
   * preventing declaration supersession attacks.
   */
  capability_declaration_oid?: string
  scope_narrowing?: Record<string, unknown>
  additional_preconditions?: CapabilityPredicate[]
  /**
   * M-4: Operator override for receipt signing on this specific scope. When
   * set, takes precedence over the capability declaration's
   * require_signed_receipt. Allows a compliance deployment to require signed
   * receipts for every action regardless of what the actor declared.
   */
  require_signed_receipt?: boolean
}

export interface CapabilityGrantBody {
  grantee: {
    actor_type: GapActorType
    actor_oid: string
    actor_session_id?: string
  }
  capability_scopes: GrantedCapabilityScope[]
  granted_at_ms: number
  expires_at_ms: number | null
  limits?: {
    max_invocations_per_minute?: number
    max_invocations_total?: number
    max_payload_bytes?: number
    /**
     * Rolling-window aggregate constraints. Each entry specifies an invocation
     * args key to sum across invocations and a ceiling within a rolling time
     * window. Example: { key: 'amount_usd', max: 10000, window_seconds: 3600 }
     * denies invocations that would push the rolling sum above $10,000/hr.
     * Enables financial controls that a per-invocation cap cannot provide.
     */
    aggregate_limits?: Array<{
      /** Invocation args key to aggregate (must be a numeric value). */
      key: string
      /** Maximum allowed sum within the rolling window. */
      max: number
      /** Length of the rolling window in seconds. */
      window_seconds: number
    }>
    /**
     * Named pool identifier for cross-grant aggregate limit groups. All grants
     * with the same aggregate_limit_group share rolling aggregate counters
     * defined in the tenant's pool configuration. The gateway MUST maintain
     * atomic counters per pool and MUST deny any invocation from any grant in
     * the pool that would exceed the pool ceiling.
     */
    aggregate_limit_group?: string
  }
  granted_by: string
  reason?: string
  evidence_oids?: string[]
  revocation_level_override?: 1 | 2 | 3
  /**
   * Operator override for receipt signing on a per-scope basis. When set,
   * takes precedence over the capability declaration's require_signed_receipt.
   * Allows an operator to require signing for a capability the actor declared
   * as unsigned (e.g. a compliance deployment that needs signed receipts for
   * every action), or to suppress signing for a high-frequency capability
   * the actor flagged as requiring it.
   */
  require_signed_receipt?: boolean

  /**
   * OID of the parent grant when this grant was delegated from another actor.
   * When present the gateway MUST verify the parent grant covers all
   * capability_scopes in this grant before accepting it. Enables verifiable
   * delegation chains (orchestrator -> sub-agent). max_delegation_depth caps
   * how many hops this grant may be further delegated.
   */
  parent_grant_oid?: string
  /**
   * Maximum number of additional delegation hops permitted below this grant.
   * When absent from a grant covering any capability with physical_safety=true,
   * the gateway MUST treat it as 0 (no sub-delegation). A gateway-enforced hard
   * cap of 10 applies regardless of the value set here.
   */
  max_delegation_depth?: number
  /**
   * For safety_class C without physical_safety: override for the default
   * timestamp validation window in seconds. Gateway applies its default if absent.
   */
  timestamp_window_seconds?: number
  /**
   * Additional seconds beyond grant expiry during which offline provisional
   * receipts are accepted at reconciliation. Defaults to 0.
   */
  offline_grace_seconds?: number
  /**
   * Maximum duration any device may use this grant without syncing to the
   * gateway. After this window, further invocations MUST be denied until
   * the device reconnects.
   */
  max_grant_offline_ttl_ms?: number
  /**
   * Maximum acceptable age of a revocation bundle for this grant. Devices
   * MUST deny physical_safety/class C invocations if the bundle is older
   * than this value.
   */
  max_revocation_bundle_age_ms?: number

  // -- Break-glass fields ------------------------------------------------------

  /**
   * When true, marks this grant as a break-glass grant. A break-glass grant
   * pre-authorizes a defined set of emergency capabilities with an
   * offline-verifiable signed token, for use when the gateway is unreachable
   * and immediate action is required for safety or clinical reasons.
   */
  break_glass?: boolean
  /**
   * TTL of the break-glass token in milliseconds from issuance.
   * RECOMMENDED: 4 hours (14_400_000 ms). Required when break_glass is true.
   */
  break_glass_ttl_ms?: number
  /**
   * Maximum invocations allowed under this token before it is exhausted.
   * Defaults to 1 for safety_class C.
   */
  break_glass_max_invocations?: number
  /**
   * When true, the invoker MUST supply a break_glass_reason string in
   * invocation args when activating break-glass operation.
   */
  break_glass_requires_reason?: boolean
  /**
   * Item 6 [DESIGN]: Compartment label for this grant. At invocation time,
   * if the grant carries a compartment the invocation compartment MUST exactly
   * match. Cross-compartment access requires a bridge grant issued through a
   * TPI-gated HITL workflow.
   */
  compartment?: string
}

export type CapabilityGrant = GapCdroEnvelope<CapabilityGrantBody>

// -- Invocation ---------------------------------------------------------------

export interface CapabilityInvocationBody {
  caller: {
    actor_type: GapActorType
    actor_oid: string
    actor_session_id?: string
    grant_oid: string
  }
  capability: string
  /**
   * OID of the capability's declaration envelope. Optional routing hint --
   * the gateway resolves it from the grant if omitted. When provided, the
   * gateway MAY use it to skip the declaration lookup.
   */
  capability_declaration_oid?: string
  args: Record<string, unknown>
  workflow_context?: {
    workflow_instance_oid: string
    stage_id: string
  }
  sla_hint?: {
    max_latency_ms?: number
    deferrable?: boolean
  }
  idempotency_key?: string
  /**
   * Server-stamped. Clients SHOULD omit this field; the gateway sets it to
   * the time the invocation was received. If provided by the client, the
   * value is accepted as-is but the gateway may override it.
   */
  invoked_at_ms?: number
  /**
   * Unix epoch ms when the action originally occurred in the caller's reference
   * frame (game-world time, clinical queue time, SCADA scan cycle). Populated
   * by the client; not used for replay prevention. Stored in receipt for audit.
   */
  client_event_ms?: number
  /**
   * Unix epoch ms when the invocation was enqueued for submission (e.g. at
   * reconnect after an offline period). Optional; aids debugging of delivery
   * latency.
   */
  queued_at_ms?: number
  /**
   * Item 1 [DESIGN]: Delegation chain steps, when this invocation was reached
   * through a multi-hop orchestration chain. Max 10 steps; gateway returns
   * HTTP 400 'delegation_depth_exceeded' when length exceeds 10.
   */
  delegation_chain?: DelegationStep[]
  /**
   * Item 2 [DESIGN]: Raw MCP tool-call context when the capability was
   * auto-generated from an MCP tools/list response. The gateway validates
   * server_id is non-empty and tool_name does not start with 'gap:'.
   */
  mcp_tool_call?: McpToolCallContext
  /**
   * Item 6 [DESIGN]: Compartment label on this invocation. MUST exactly match
   * the grant's compartment when the grant carries one. The gateway MUST return
   * HTTP 404 (not HTTP 403) when the invoking actor's compartment level is
   * insufficient to know a resource exists.
   */
  compartment?: string
}

export type CapabilityInvocation = GapCdroEnvelope<CapabilityInvocationBody>

// -- Key distribution ---------------------------------------------------------

export interface KeyEntry {
  key_id: string
  public_key_base64: string
  algorithm: 'Ed25519' | 'ML-DSA-65' | 'Ed25519+ML-DSA-65'
  valid_from_ms: number
  expires_at_ms: number
}

export interface KeyringExportBody {
  keys: KeyEntry[]
  exported_at_ms: number
  expires_at_ms: number
}

// -- Offline Execution Profile ------------------------------------------------

export interface OfflinePolicy {
  max_offline_duration_ms: number
  max_offline_invocations: number
  offline_capability_filter?: string[]
  offline_allowed?: boolean
}

export interface OfflineBundleBody {
  grant: CapabilityGrant
  declaration: CapabilityDeclaration
  keyring: KeyringExportBody
  revocation_snapshot: RevocationSnapshotBody
  offline_policy: OfflinePolicy
}

// -- Revocation bundle --------------------------------------------------------

export interface RevocationEntry {
  grant_oid: string
  effective_at_ms: number
  kind: 'immediate' | 'scheduled' | 'provisional_block'
}

export interface RevocationSnapshotBody {
  revocations: RevocationEntry[]
  snapshot_at_ms: number
  expires_at_ms: number
  tenant_id: string
}

// -- Capability pattern matching ----------------------------------------------

// -- Break-glass --------------------------------------------------------------

export interface BreakGlassTokenBody {
  grant_oid: string
  actor_oid: string
  valid_from_ms: number
  expires_at_ms: number
  permitted_capabilities: string[]
  max_invocations: number
}

export interface LocalOverrideCredentialBody {
  grant_oid: string
  actor_oid: string
  expires_at_ms: number
  single_use: true
  override_reason_required: boolean
}

// -- C16: GDPR erasure event --------------------------------------------------

/**
 * C16: Body of a gap:erasure_event CDRO. Replaces the body of the targeted
 * receipt with a fixed erasure sentinel while preserving envelope metadata.
 * The erasure event OID anchors to the original CDRO OID and is itself a
 * signed CDRO, making it non-repudiable. Verifiers MUST treat an erasure event
 * as authoritative over the prior OID body.
 */
export interface ErasureEventBody {
  /** OID of the CDRO being erased. */
  target_oid: string
  /** Reason code for the erasure. */
  erasure_reason: 'gdpr_article_17' | 'ccpa' | 'operator_policy'
  /** Unix epoch ms of erasure. */
  erased_at_ms: number
  /** Actor OID issuing the erasure. */
  erased_by: string
  /** Array of field paths erased from the target CDRO body. */
  fields_erased: string[]
}

// -- C12: Self-Sovereign Credential (LCA root) --------------------------------

/**
 * C12: Body of a gap:lca_root CDRO. Bootstraps a Local Credential Authority
 * for deployments without external connectivity or without a SynOI-operated
 * token issuer. The LCA root is signed by the local root key; actor credentials
 * are then issued by the LCA and verified using the locally-held LCA public key.
 */
export interface LcaRootBody {
  root_public_key_base64: string
  algorithm: 'ML-DSA-65' | 'Ed25519'
  tenant_id: string
  valid_from_ms: number
  expires_at_ms: number
}

// -- Capability pattern matching ----------------------------------------------

/**
 * Match a capability `target` against a `pattern`.
 *
 * Rules (matching the GAP gateway reference implementation):
 *   - Exact string match returns true.
 *   - A pattern ending in `*` matches any target with the prefix before `*`.
 *   - Everything else returns false.
 *
 * Examples:
 *   capabilityMatches('skill.create',  'skill.create')  // true
 *   capabilityMatches('skill.*',       'skill.create')  // true
 *   capabilityMatches('skill.*',       'skill.update')  // true
 *   capabilityMatches('skill.create',  'skill.update')  // false
 *   capabilityMatches('*',             'anything')      // true
 */
export function capabilityMatches(pattern: string, target: string): boolean {
  if (pattern === target) return true
  if (pattern === '*') return true   // match-all
  // M-8: Two wildcard levels.
  // 'prefix.**' matches all descendants recursively (the prefix itself OR any
  // path under it). Must be checked before '.*' because '.**' ends with '.*'.
  if (pattern.endsWith('.**')) {
    const prefix = pattern.slice(0, -3)  // strip '.**'
    return target === prefix || target.startsWith(prefix + '.')
  }
  // Segment-boundary wildcard: 'skill.*' matches 'skill.create' (direct
  // children only -- single path segment). A non-boundary pattern like
  // 'admin.us*' must NOT prefix-match 'admin.users.delete' (privilege-
  // escalation footgun). The '*' must follow a '.'.
  if (pattern.endsWith('.*')) {
    const prefix = pattern.slice(0, -1)   // keep the trailing '.', e.g. 'skill.'
    return target.startsWith(prefix)
  }
  return false
}
