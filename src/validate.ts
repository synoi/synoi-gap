/**
 * validate.ts -- hand-rolled runtime validators for GAP CDROs.
 *
 * Design: every validator returns `{ ok, errors }`. `ok` is true iff `errors`
 * is empty. Validators are non-throwing. They check shape (type + required
 * fields) without semantic validation (a grant with `expires_at_ms` in the
 * past is "shape-valid" -- separate runtime check rejects it).
 *
 * No zod / no io-ts. The style mirrors synoi-mcp-server/src/tools.ts:
 * minimal, predictable, and easy to debug.
 *
 * Round-trip property: any envelope produced by these types, run through
 * JSON.stringify -> JSON.parse -> validate*, produces ok=true with the same
 * top-level keys + values.
 */

import type { GapCdroEnvelope, GapObjectType } from './cdro.js'
import { GAP_VERSION } from './cdro.js'
import type {
  GapActorType,
  Capability,
  CapabilityDeclaration,
  CapabilityDeclarationBody,
  CapabilityGrant,
  CapabilityGrantBody,
  CapabilityInvocation,
  CapabilityInvocationBody,
  CapabilityPredicate,
  GrantedCapabilityScope,
  ConsentRecordBody,
  CredentialKind,
  DelegationStep,
  IdentityBinding,
  McpToolCallContext,
  OrchestrationChainBody,
  PipResponseBody,
  TokenBudgetArgs,
  ExternalPipArgs,
} from './capabilities.js'
import type { TokenConsumption } from './receipts.js'
import type {
  ChannelEvent,
  ChannelEventBody,
} from './channels.js'
import type {
  StageTransition,
  StageTransitionBody,
  WorkflowDefinition,
  WorkflowDefinitionBody,
  WorkflowInstance,
  WorkflowInstanceBody,
} from './workflows.js'
import type {
  GapDecisionReceipt,
  GapDecisionReceiptBody,
} from './receipts.js'
import type {
  RevocationEvent,
  RevocationEventBody,
} from './revocations.js'

// -- Result + small helpers --------------------------------------------------

export interface ValidationResult {
  ok: boolean
  errors: string[]
}

function ok(): ValidationResult { return { ok: true, errors: [] } }
function fail(...errors: string[]): ValidationResult { return { ok: false, errors } }
function merge(...results: ValidationResult[]): ValidationResult {
  const errors: string[] = []
  for (const r of results) errors.push(...r.errors)
  return { ok: errors.length === 0, errors }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
function isString(v: unknown): v is string { return typeof v === 'string' }
function isNumber(v: unknown): v is number { return typeof v === 'number' && Number.isFinite(v) }
function isInteger(v: unknown): v is number { return Number.isInteger(v as number) }
function isBoolean(v: unknown): v is boolean { return typeof v === 'boolean' }
function isArray(v: unknown): v is unknown[] { return Array.isArray(v) }

function requireField(
  parent: string,
  obj: Record<string, unknown>,
  key: string,
  predicate: (v: unknown) => boolean,
  typeName: string,
): ValidationResult {
  if (!(key in obj)) return fail(`${parent}.${key}: missing required field`)
  if (!predicate(obj[key])) return fail(`${parent}.${key}: expected ${typeName}`)
  return ok()
}

function optionalField(
  parent: string,
  obj: Record<string, unknown>,
  key: string,
  predicate: (v: unknown) => boolean,
  typeName: string,
): ValidationResult {
  if (!(key in obj) || obj[key] === undefined) return ok()
  if (!predicate(obj[key])) return fail(`${parent}.${key}: expected ${typeName}`)
  return ok()
}

function isOneOf<T extends string>(values: readonly T[]): (v: unknown) => v is T {
  return (v: unknown): v is T => typeof v === 'string' && (values as readonly string[]).includes(v)
}

// -- Common envelope check ---------------------------------------------------

const GAP_OBJECT_TYPES: readonly GapObjectType[] = [
  'gap:capability_declaration',
  'gap:capability_grant',
  'gap:capability_invocation',
  'gap:workflow_definition',
  'gap:workflow_instance',
  'gap:stage_transition',
  'gap:channel_event',
  'gap:decision_receipt',
  'gap:revocation_event',
  'gap:federation_handshake', // reserved for GAP 1.1 - accepted but not required for any conformance tier
  'gap:break_glass_token',
  'gap:local_override_credential',
  'gap:lca_root',
  'gap:erasure_event',
  // Item 1: Agent Delegation Chain
  'gap:orchestration_chain',
  // Item 4: Consent Version Chain
  'gap:consent_record',
  // Item 7: Signed PIP Response
  'gap:pip_response',
]

function validateEnvelopeShape(x: unknown, expectedType: GapObjectType): ValidationResult {
  if (!isObject(x)) return fail('envelope: expected object')
  const errors: string[] = []
  if (!isString(x['oid'])) errors.push('envelope.oid: expected string')
  else if (!x['oid'].startsWith('sha256:')) errors.push('envelope.oid: expected "sha256:<hex>" prefix')
  if (x['type'] !== expectedType) errors.push(`envelope.type: expected "${expectedType}"`)
  else if (!(GAP_OBJECT_TYPES as readonly string[]).includes(x['type'] as string)) {
    errors.push('envelope.type: unknown GAP object type')
  }
  if (x['gap_version'] !== GAP_VERSION) {
    errors.push(`envelope.gap_version: expected "${GAP_VERSION}"`)
  }
  if (!isString(x['tenant_id'])) errors.push('envelope.tenant_id: expected string')
  if (!isInteger(x['created_at_ms'])) errors.push('envelope.created_at_ms: expected integer')
  if (!isString(x['created_by'])) errors.push('envelope.created_by: expected string')
  if (!('body' in x) || !isObject(x['body'])) errors.push('envelope.body: expected object')
  if ('signature' in x && x['signature'] !== undefined && !isString(x['signature'])) {
    errors.push('envelope.signature: expected string')
  }
  if ('signature_key_id' in x && x['signature_key_id'] !== undefined && !isString(x['signature_key_id'])) {
    errors.push('envelope.signature_key_id: expected string')
  }
  if ('supersedes' in x && x['supersedes'] !== undefined && !isString(x['supersedes'])) {
    errors.push('envelope.supersedes: expected string')
  }
  return errors.length === 0 ? ok() : fail(...errors)
}

// -- Reusable inner-shape validators -----------------------------------------

const ACTOR_TYPES: readonly GapActorType[] = [
  'skill', 'service', 'device', 'agent', 'mcp_server', 'gateway_subsystem', 'human_user',
]
const isActorType = isOneOf(ACTOR_TYPES)

function validatePredicate(parent: string, p: unknown): ValidationResult {
  if (!isObject(p)) return fail(`${parent}: expected object`)
  return merge(
    requireField(parent, p, 'kind', isString, 'string'),
    requireField(parent, p, 'args', isObject, 'object'),
  )
}

function validatePredicateArray(parent: string, arr: unknown): ValidationResult {
  if (!isArray(arr)) return fail(`${parent}: expected array`)
  const merged: ValidationResult[] = []
  arr.forEach((p, i) => merged.push(validatePredicate(`${parent}[${i}]`, p)))
  return merge(...merged)
}

function validateCapability(parent: string, c: unknown): ValidationResult {
  if (!isObject(c)) return fail(`${parent}: expected object`)
  const errors: ValidationResult[] = [
    requireField(parent, c, 'capability', isString, 'string'),
  ]
  if (c['scope'] !== undefined) errors.push(requireField(parent, c, 'scope', isObject, 'object'))
  if (c['preconditions'] !== undefined) errors.push(validatePredicateArray(`${parent}.preconditions`, c['preconditions']))
  if (c['safety_class'] !== undefined) {
    errors.push(requireField(parent, c, 'safety_class', isOneOf(['A', 'B', 'C'] as const), '"A" | "B" | "C"'))
  }
  if (c['physical_safety'] !== undefined) errors.push(requireField(parent, c, 'physical_safety', isBoolean, 'boolean'))
  if (c['require_signed_receipt'] !== undefined) errors.push(requireField(parent, c, 'require_signed_receipt', isBoolean, 'boolean'))
  if (c['pii_args'] !== undefined) {
    if (!isArray(c['pii_args']) || !c['pii_args'].every(isString)) {
      errors.push(fail(`${parent}.pii_args: expected string[]`))
    }
  }
  if (c['privilege_protected'] !== undefined) {
    errors.push(requireField(parent, c, 'privilege_protected', isBoolean, 'boolean'))
  }
  return merge(...errors)
}

function validateScope(parent: string, s: unknown): ValidationResult {
  if (!isObject(s)) return fail(`${parent}: expected object`)
  const errors: ValidationResult[] = [
    requireField(parent, s, 'capability', isString, 'string'),
  ]
  if (s['capability_declaration_oid'] !== undefined) {
    errors.push(requireField(parent, s, 'capability_declaration_oid', isString, 'string'))
  }
  if (s['scope_narrowing'] !== undefined) {
    errors.push(requireField(parent, s, 'scope_narrowing', isObject, 'object'))
  }
  if (s['additional_preconditions'] !== undefined) {
    errors.push(validatePredicateArray(`${parent}.additional_preconditions`, s['additional_preconditions']))
  }
  if (s['require_signed_receipt'] !== undefined) {
    errors.push(requireField(parent, s, 'require_signed_receipt', isBoolean, 'boolean'))
  }
  return merge(...errors)
}

// -- Item 1: Delegation step validator ---------------------------------------

function validateDelegationStep(parent: string, s: unknown): ValidationResult {
  if (!isObject(s)) return fail(`${parent}: expected object`)
  return merge(
    requireField(parent, s, 'step_index', (v) => isNumber(v) && Number.isInteger(v) && (v as number) >= 0, 'non-negative integer'),
    requireField(parent, s, 'delegator_actor_oid', isString, 'string'),
    requireField(parent, s, 'delegatee_actor_oid', isString, 'string'),
    requireField(parent, s, 'grant_oid', isString, 'string'),
    requireField(parent, s, 'delegated_at_ms', isInteger, 'integer'),
    requireField(parent, s, 'step_signature', (v) => isString(v) && (v as string).length > 0, 'non-empty string'),
    requireField(parent, s, 'step_signature_alg', (v) => isString(v) && (v as string).length > 0, 'non-empty string'),
    optionalField(parent, s, 'prior_receipt_oid', isString, 'string'),
  )
}

/**
 * [DESIGN] Validates a gap:orchestration_chain body. Returns error
 * 'delegation_depth_exceeded' when steps.length > 10.
 */
export function validateOrchestrationChainBody(x: unknown): ValidationResult {
  if (!isObject(x)) return fail('body: expected object')
  const errors: ValidationResult[] = [
    requireField('body', x, 'root_actor_oid', isString, 'string'),
    requireField('body', x, 'capability_name', isString, 'string'),
    requireField('body', x, 'final_invocation_oid', isString, 'string'),
  ]
  if (!isArray(x['steps'])) {
    errors.push(fail('body.steps: expected array'))
  } else {
    if ((x['steps'] as unknown[]).length > 10) {
      errors.push(fail('delegation_depth_exceeded: steps array exceeds maximum of 10 hops'))
    }
    ;(x['steps'] as unknown[]).forEach((s, i) =>
      errors.push(validateDelegationStep(`body.steps[${i}]`, s))
    )
  }
  return merge(...errors)
}

// -- Item 2: MCP tool-call context validator ---------------------------------

function validateMcpToolCallContext(parent: string, m: unknown): ValidationResult {
  if (!isObject(m)) return fail(`${parent}: expected object`)
  const errors: ValidationResult[] = [
    requireField(parent, m, 'server_id', (v) => isString(v) && (v as string).length > 0, 'non-empty string'),
    requireField(parent, m, 'tool_name', isString, 'string'),
  ]
  if (isString(m['tool_name']) && (m['tool_name'] as string).startsWith('gap:')) {
    errors.push(fail(`${parent}.tool_name: MCP tool names MUST NOT start with 'gap:' (namespace reserved)`))
  }
  if (m['tool_schema_hash'] !== undefined) {
    errors.push(optionalField(parent, m, 'tool_schema_hash', isString, 'string'))
  }
  return merge(...errors)
}

// -- Item 3: Token consumption validator -------------------------------------

/**
 * [DESIGN] Validates a TokenConsumption object from a receipt body.
 */
export function validateTokenConsumption(x: unknown): ValidationResult {
  if (!isObject(x)) return fail('token_consumption: expected object')
  const isNonNegInt = (v: unknown): v is number =>
    isNumber(v) && Number.isInteger(v) && (v as number) >= 0
  return merge(
    requireField('token_consumption', x, 'input_tokens', isNonNegInt, 'non-negative integer'),
    requireField('token_consumption', x, 'output_tokens', isNonNegInt, 'non-negative integer'),
    requireField('token_consumption', x, 'model', (v) => isString(v) && (v as string).length > 0, 'non-empty string'),
    requireField('token_consumption', x, 'settled_at_ms', isInteger, 'integer'),
    optionalField('token_consumption', x, 'cost_usd', isNumber, 'number'),
  )
}

// -- [0024]: Measured result validator ---------------------------------------

/**
 * [DESIGN] Validates a MeasuredResult block from a receipt body ([0024]:
 * measured cost + quantity, result id, counterparty, lineage edge). Every
 * field is optional (backward compatible); when present each is shape- and
 * range-checked. cost_micro_usd and latency_ms must be non-negative integers
 * (the GAP canonicalizer forbids floats, so a float cost would make the
 * receipt unsignable); the string references must be non-empty.
 */
export function validateMeasuredResult(x: unknown): ValidationResult {
  if (!isObject(x)) return fail('measured: expected object')
  const isNonNegInt = (v: unknown): v is number =>
    isNumber(v) && Number.isInteger(v) && (v as number) >= 0
  const isNonEmptyString = (v: unknown): v is string => isString(v) && (v as string).length > 0
  return merge(
    optionalField('measured', x, 'cost_micro_usd', isNonNegInt, 'non-negative integer (micro-USD)'),
    optionalField('measured', x, 'latency_ms', isNonNegInt, 'non-negative integer'),
    optionalField('measured', x, 'provider_ran', isNonEmptyString, 'non-empty string'),
    optionalField('measured', x, 'counterparty', isNonEmptyString, 'non-empty string'),
    optionalField('measured', x, 'upstream_ref', isNonEmptyString, 'non-empty string'),
  )
}

// -- Item 4: Consent record validator ----------------------------------------

/**
 * [DESIGN] Validates a gap:consent_record body. consented MUST be boolean;
 * actor_oid and context are required.
 */
export function validateConsentRecordBody(x: unknown): ValidationResult {
  if (!isObject(x)) return fail('body: expected object')
  return merge(
    requireField('body', x, 'actor_oid', (v) => isString(v) && (v as string).length > 0, 'non-empty string'),
    requireField('body', x, 'tenant_id', isString, 'string'),
    requireField('body', x, 'context', (v) => isString(v) && (v as string).length > 0, 'non-empty string'),
    requireField('body', x, 'consented', isBoolean, 'boolean'),
    requireField('body', x, 'consented_at_ms', isInteger, 'integer'),
    optionalField('body', x, 'prior_consent_oid', isString, 'string'),
    optionalField('body', x, 'expires_at_ms', isInteger, 'integer'),
    optionalField('body', x, 'consent_text_hash', isString, 'string'),
  )
}

// -- Item 5: Identity binding validator --------------------------------------

const CREDENTIAL_KINDS: readonly CredentialKind[] = [
  'piv_cac', 'x509', 'fido2', 'tpm_attestation',
  'oidc_sub', 'spiffe_svid', 'wallet_address', 'professional_license',
]
const isCredentialKind = isOneOf(CREDENTIAL_KINDS)

function validateIdentityBinding(parent: string, b: unknown): ValidationResult {
  if (!isObject(b)) return fail(`${parent}: expected object`)
  return merge(
    requireField(parent, b, 'credential_kind', isCredentialKind,
      '"piv_cac" | "x509" | "fido2" | "tpm_attestation" | "oidc_sub" | "spiffe_svid" | "wallet_address" | "professional_license"'),
    requireField(parent, b, 'credential_identifier', (v) => isString(v) && (v as string).length > 0, 'non-empty string'),
    requireField(parent, b, 'binding_signature', (v) => isString(v) && (v as string).length > 0, 'non-empty string'),
    requireField(parent, b, 'binding_alg', (v) => isString(v) && (v as string).length > 0, 'non-empty string'),
    requireField(parent, b, 'bound_at_ms', isInteger, 'integer'),
    optionalField(parent, b, 'issuer', isString, 'string'),
    optionalField(parent, b, 'expires_at_ms', isInteger, 'integer'),
  )
}

// -- Item 6: Compartment validator -------------------------------------------

/**
 * Validates a compartment label. Accepted values: 'UNCLASS', 'CUI', or a
 * reverse-domain label (starts with a letter, contains at least one dot, no
 * spaces, no leading 'gap:').
 */
function isValidCompartment(v: unknown): v is string {
  if (!isString(v)) return false
  const s = v as string
  if (s === 'UNCLASS' || s === 'CUI') return true
  // Reverse-domain: starts with letter, contains a dot, no spaces
  return /^[a-zA-Z][a-zA-Z0-9_-]*(\.[a-zA-Z0-9_-]+)+$/.test(s)
}

// -- Item 7: PIP response validator ------------------------------------------

/**
 * [DESIGN] Validates a gap:pip_response body.
 */
export function validatePipResponseBody(x: unknown): ValidationResult {
  if (!isObject(x)) return fail('body: expected object')
  return merge(
    requireField('body', x, 'pip_endpoint', (v) => isString(v) && (v as string).length > 0, 'non-empty string'),
    requireField('body', x, 'request_args_hash', (v) => isString(v) && (v as string).length > 0, 'non-empty string'),
    requireField('body', x, 'response_body_hash', (v) => isString(v) && (v as string).length > 0, 'non-empty string'),
    requireField('body', x, 'evaluated_at_ms', isInteger, 'integer'),
    requireField('body', x, 'cache_ttl_ms', (v) => isInteger(v) && (v as number) >= 0, 'non-negative integer'),
    optionalField('body', x, 'response_summary', isString, 'string'),
    optionalField('body', x, 'pip_signature', isString, 'string'),
    optionalField('body', x, 'pip_signature_alg', isString, 'string'),
  )
}

// -- Body validators ---------------------------------------------------------

export function validateCapabilityDeclarationBody(x: unknown): ValidationResult {
  if (!isObject(x)) return fail('body: expected object')
  const errors: ValidationResult[] = [
    requireField('body', x, 'actor_type', isActorType, 'GapActorType'),
    requireField('body', x, 'actor_id', isString, 'string'),
    requireField('body', x, 'actor_name', isString, 'string'),
    requireField('body', x, 'actor_version', isString, 'string'),
  ]
  if (x['source_url'] !== undefined) errors.push(requireField('body', x, 'source_url', isString, 'string'))
  if (x['parent_oid'] !== undefined) errors.push(requireField('body', x, 'parent_oid', isString, 'string'))
  if (!isArray(x['capabilities'])) {
    errors.push(fail('body.capabilities: expected array'))
  } else {
    x['capabilities'].forEach((c, i) => errors.push(validateCapability(`body.capabilities[${i}]`, c)))
  }
  if (x['human_summary'] !== undefined) errors.push(requireField('body', x, 'human_summary', isString, 'string'))
  if (x['privacy_classification'] !== undefined) {
    errors.push(requireField('body', x, 'privacy_classification',
      isOneOf(['public', 'restricted', 'sensitive', 'phi', 'pii', 'financial', 'privileged'] as const),
      '"public" | "restricted" | "sensitive" | "phi" | "pii" | "financial" | "privileged"'))
  }
  if (x['declared_limits'] !== undefined) {
    if (!isObject(x['declared_limits'])) errors.push(fail('body.declared_limits: expected object'))
  }
  // C15: ephemeral actor lifecycle fields
  if (x['actor_lifecycle'] !== undefined) {
    errors.push(requireField('body', x, 'actor_lifecycle',
      isOneOf(['persistent', 'ephemeral'] as const),
      '"persistent" | "ephemeral"'))
  }
  if (x['actor_instance_id'] !== undefined) {
    errors.push(requireField('body', x, 'actor_instance_id', isString, 'string'))
  }
  if (x['session_expires_at_ms'] !== undefined) {
    errors.push(requireField('body', x, 'session_expires_at_ms', isInteger, 'integer'))
  }
  // Item 5: identity_binding
  if (x['identity_binding'] !== undefined) {
    errors.push(validateIdentityBinding('body.identity_binding', x['identity_binding']))
  }
  // Item 6: compartment
  if (x['compartment'] !== undefined) {
    if (!isValidCompartment(x['compartment'])) {
      errors.push(fail('body.compartment: expected "UNCLASS", "CUI", or a reverse-domain label (e.g. "com.acme.project-alpha")'))
    }
  }
  return merge(...errors)
}

export function validateCapabilityGrantBody(x: unknown): ValidationResult {
  if (!isObject(x)) return fail('body: expected object')
  const errors: ValidationResult[] = []
  // grantee
  if (!isObject(x['grantee'])) {
    errors.push(fail('body.grantee: expected object'))
  } else {
    const g = x['grantee']
    errors.push(
      requireField('body.grantee', g, 'actor_type', isActorType, 'GapActorType'),
      requireField('body.grantee', g, 'actor_oid', isString, 'string'),
      optionalField('body.grantee', g, 'actor_session_id', isString, 'string'),
    )
  }
  // capability_scopes
  if (!isArray(x['capability_scopes'])) {
    errors.push(fail('body.capability_scopes: expected array'))
  } else {
    x['capability_scopes'].forEach((s, i) => errors.push(validateScope(`body.capability_scopes[${i}]`, s)))
  }
  errors.push(requireField('body', x, 'granted_at_ms', isInteger, 'integer'))
  // expires_at_ms can be integer | null
  if (!('expires_at_ms' in x)) {
    errors.push(fail('body.expires_at_ms: missing required field'))
  } else if (x['expires_at_ms'] !== null && !isInteger(x['expires_at_ms'])) {
    errors.push(fail('body.expires_at_ms: expected integer | null'))
  }
  errors.push(requireField('body', x, 'granted_by', isString, 'string'))
  if (x['reason'] !== undefined) errors.push(requireField('body', x, 'reason', isString, 'string'))
  if (x['evidence_oids'] !== undefined) {
    if (!isArray(x['evidence_oids']) || !x['evidence_oids'].every(isString)) {
      errors.push(fail('body.evidence_oids: expected string[]'))
    }
  }
  if (x['revocation_level_override'] !== undefined) {
    if (x['revocation_level_override'] !== 1 && x['revocation_level_override'] !== 2 && x['revocation_level_override'] !== 3) {
      errors.push(fail('body.revocation_level_override: expected 1 | 2 | 3'))
    }
  }
  if (x['limits'] !== undefined) {
    if (!isObject(x['limits'])) {
      errors.push(fail('body.limits: expected object'))
    } else {
      const lim = x['limits']
      if (lim['aggregate_limits'] !== undefined) {
        if (!isArray(lim['aggregate_limits'])) {
          errors.push(fail('body.limits.aggregate_limits: expected array'))
        } else {
          lim['aggregate_limits'].forEach((entry: unknown, i: number) => {
            if (!isObject(entry)) {
              errors.push(fail(`body.limits.aggregate_limits[${i}]: expected object`))
              return
            }
            errors.push(
              requireField(`body.limits.aggregate_limits[${i}]`, entry, 'key', isString, 'string'),
              requireField(`body.limits.aggregate_limits[${i}]`, entry, 'max', (v) => isInteger(v) && (v as number) >= 0, 'integer >= 0'),
              requireField(`body.limits.aggregate_limits[${i}]`, entry, 'window_seconds', (v) => isInteger(v) && (v as number) > 0, 'integer > 0'),
            )
          })
        }
      }
      // C7: cross-grant aggregate limit group
      if (lim['aggregate_limit_group'] !== undefined) {
        errors.push(optionalField('body.limits', lim, 'aggregate_limit_group', isString, 'string'))
      }
    }
  }
  if (x['parent_grant_oid'] !== undefined) {
    errors.push(requireField('body', x, 'parent_grant_oid', isString, 'string'))
  }
  if (x['max_delegation_depth'] !== undefined) {
    if (!isNumber(x['max_delegation_depth']) || !Number.isInteger(x['max_delegation_depth']) || (x['max_delegation_depth'] as number) < 0) {
      errors.push(fail('body.max_delegation_depth: expected non-negative integer'))
    }
  }
  const isPositiveInteger = (v: unknown): v is number =>
    isNumber(v) && Number.isInteger(v) && (v as number) > 0
  if (x['timestamp_window_seconds'] !== undefined) {
    if (!isPositiveInteger(x['timestamp_window_seconds'])) {
      errors.push(fail('body.timestamp_window_seconds: expected positive integer'))
    }
  }
  if (x['offline_grace_seconds'] !== undefined) {
    if (!isNumber(x['offline_grace_seconds']) || !Number.isInteger(x['offline_grace_seconds']) || (x['offline_grace_seconds'] as number) < 0) {
      errors.push(fail('body.offline_grace_seconds: expected non-negative integer'))
    }
  }
  if (x['max_grant_offline_ttl_ms'] !== undefined) {
    if (!isPositiveInteger(x['max_grant_offline_ttl_ms'])) {
      errors.push(fail('body.max_grant_offline_ttl_ms: expected positive integer'))
    }
  }
  if (x['max_revocation_bundle_age_ms'] !== undefined) {
    if (!isPositiveInteger(x['max_revocation_bundle_age_ms'])) {
      errors.push(fail('body.max_revocation_bundle_age_ms: expected positive integer'))
    }
  }
  // -- Break-glass optional fields -------------------------------------------
  if (x['break_glass'] !== undefined) {
    errors.push(optionalField('body', x, 'break_glass', isBoolean, 'boolean'))
  }
  if (x['break_glass_ttl_ms'] !== undefined) {
    if (!isPositiveInteger(x['break_glass_ttl_ms'])) {
      errors.push(fail('body.break_glass_ttl_ms: expected positive integer'))
    }
  }
  if (x['break_glass_max_invocations'] !== undefined) {
    if (!isPositiveInteger(x['break_glass_max_invocations'])) {
      errors.push(fail('body.break_glass_max_invocations: expected positive integer'))
    }
  }
  if (x['break_glass_requires_reason'] !== undefined) {
    errors.push(optionalField('body', x, 'break_glass_requires_reason', isBoolean, 'boolean'))
  }
  // Item 6: compartment
  if (x['compartment'] !== undefined) {
    if (!isValidCompartment(x['compartment'])) {
      errors.push(fail('body.compartment: expected "UNCLASS", "CUI", or a reverse-domain label (e.g. "com.acme.project-alpha")'))
    }
  }
  return merge(...errors)
}

export function validateCapabilityInvocationBody(x: unknown): ValidationResult {
  if (!isObject(x)) return fail('body: expected object')
  const errors: ValidationResult[] = []
  if (!isObject(x['caller'])) {
    errors.push(fail('body.caller: expected object'))
  } else {
    const c = x['caller']
    errors.push(
      requireField('body.caller', c, 'actor_type', isActorType, 'GapActorType'),
      requireField('body.caller', c, 'actor_oid', isString, 'string'),
      requireField('body.caller', c, 'grant_oid', isString, 'string'),
      optionalField('body.caller', c, 'actor_session_id', isString, 'string'),
    )
  }
  errors.push(
    requireField('body', x, 'capability', isString, 'string'),
    optionalField('body', x, 'capability_declaration_oid', isString, 'string'),
    requireField('body', x, 'args', isObject, 'object'),
    optionalField('body', x, 'invoked_at_ms', isInteger, 'integer'),
  )
  if (x['workflow_context'] !== undefined) {
    if (!isObject(x['workflow_context'])) {
      errors.push(fail('body.workflow_context: expected object'))
    } else {
      const wc = x['workflow_context']
      errors.push(
        requireField('body.workflow_context', wc, 'workflow_instance_oid', isString, 'string'),
        requireField('body.workflow_context', wc, 'stage_id', isString, 'string'),
      )
    }
  }
  if (x['sla_hint'] !== undefined && !isObject(x['sla_hint'])) {
    errors.push(fail('body.sla_hint: expected object'))
  }
  if (x['idempotency_key'] !== undefined) {
    errors.push(requireField('body', x, 'idempotency_key', isString, 'string'))
  }
  if (x['client_event_ms'] !== undefined) {
    errors.push(optionalField('body', x, 'client_event_ms', isInteger, 'integer'))
  }
  if (x['queued_at_ms'] !== undefined) {
    errors.push(optionalField('body', x, 'queued_at_ms', isInteger, 'integer'))
  }
  // Item 1: delegation_chain -- max 10 steps
  if (x['delegation_chain'] !== undefined) {
    if (!isArray(x['delegation_chain'])) {
      errors.push(fail('body.delegation_chain: expected array'))
    } else {
      if ((x['delegation_chain'] as unknown[]).length > 10) {
        errors.push(fail('delegation_depth_exceeded: delegation_chain exceeds maximum of 10 hops'))
      }
      ;(x['delegation_chain'] as unknown[]).forEach((s, i) =>
        errors.push(validateDelegationStep(`body.delegation_chain[${i}]`, s))
      )
    }
  }
  // Item 2: mcp_tool_call
  if (x['mcp_tool_call'] !== undefined) {
    errors.push(validateMcpToolCallContext('body.mcp_tool_call', x['mcp_tool_call']))
  }
  // Item 6: compartment
  if (x['compartment'] !== undefined) {
    if (!isValidCompartment(x['compartment'])) {
      errors.push(fail('body.compartment: expected "UNCLASS", "CUI", or a reverse-domain label (e.g. "com.acme.project-alpha")'))
    }
  }
  return merge(...errors)
}

export function validateWorkflowDefinitionBody(x: unknown): ValidationResult {
  if (!isObject(x)) return fail('body: expected object')
  const errors: ValidationResult[] = [
    requireField('body', x, 'workflow_id', isString, 'string'),
    requireField('body', x, 'workflow_name', isString, 'string'),
    requireField('body', x, 'workflow_version', isString, 'string'),
    requireField('body', x, 'initial_stage_id', isString, 'string'),
    requireField('body', x, 'max_total_duration_seconds', isInteger, 'integer'),
  ]
  if (!isObject(x['trigger'])) {
    errors.push(fail('body.trigger: expected object'))
  } else {
    errors.push(requireField('body.trigger', x['trigger'], 'kind',
      isOneOf(['risk_policy', 'capability_invocation', 'explicit', 'schedule'] as const),
      'WorkflowTriggerKind'))
  }
  if (!isArray(x['stages'])) {
    errors.push(fail('body.stages: expected array'))
  } else {
    x['stages'].forEach((s, i) => {
      if (!isObject(s)) {
        errors.push(fail(`body.stages[${i}]: expected object`))
        return
      }
      errors.push(requireField(`body.stages[${i}]`, s, 'stage_id', isString, 'string'))
      if (s['authorized_approvers'] !== undefined) {
        if (!isArray(s['authorized_approvers']) || !s['authorized_approvers'].every(isString)) {
          errors.push(fail(`body.stages[${i}].authorized_approvers: expected string[]`))
        }
      }
    })
  }
  if (!isArray(x['required_channels']) || !x['required_channels'].every(isString)) {
    errors.push(fail('body.required_channels: expected string[]'))
  }
  if (x['optional_channels'] !== undefined) {
    if (!isArray(x['optional_channels']) || !x['optional_channels'].every(isString)) {
      errors.push(fail('body.optional_channels: expected string[]'))
    }
  }
  if (x['description'] !== undefined) errors.push(requireField('body', x, 'description', isString, 'string'))
  if (x['cleanup_stage_id'] !== undefined) errors.push(requireField('body', x, 'cleanup_stage_id', isString, 'string'))
  return merge(...errors)
}

export function validateWorkflowInstanceBody(x: unknown): ValidationResult {
  if (!isObject(x)) return fail('body: expected object')
  const errors: ValidationResult[] = [
    requireField('body', x, 'workflow_definition_oid', isString, 'string'),
    requireField('body', x, 'workflow_id', isString, 'string'),
    requireField('body', x, 'current_stage_id', isString, 'string'),
    requireField('body', x, 'scope_variables', isObject, 'object'),
    requireField('body', x, 'started_at_ms', isInteger, 'integer'),
    requireField('body', x, 'last_transition_at_ms', isInteger, 'integer'),
  ]
  if (!('terminated_at_ms' in x)) {
    errors.push(fail('body.terminated_at_ms: missing required field'))
  } else if (x['terminated_at_ms'] !== null && !isInteger(x['terminated_at_ms'])) {
    errors.push(fail('body.terminated_at_ms: expected integer | null'))
  }
  if (!('terminal_outcome' in x)) {
    errors.push(fail('body.terminal_outcome: missing required field'))
  } else if (x['terminal_outcome'] !== null) {
    if (!isString(x['terminal_outcome'])
        || !['approved', 'denied', 'timed_out', 'withdrawn', 'error'].includes(x['terminal_outcome'])) {
      errors.push(fail('body.terminal_outcome: expected null | "approved" | "denied" | "timed_out" | "withdrawn" | "error"'))
    }
  }
  if (!isObject(x['trigger_event'])) {
    errors.push(fail('body.trigger_event: expected object'))
  } else {
    errors.push(
      requireField('body.trigger_event', x['trigger_event'], 'kind',
        isOneOf(['risk_policy', 'capability_invocation', 'explicit', 'schedule'] as const),
        'WorkflowTriggerKind'),
      requireField('body.trigger_event', x['trigger_event'], 'source_actor_oid', isString, 'string'),
    )
  }
  if (!isArray(x['active_channel_listeners'])) {
    errors.push(fail('body.active_channel_listeners: expected array'))
  }
  if (!isArray(x['transition_oids']) || !x['transition_oids'].every(isString)) {
    errors.push(fail('body.transition_oids: expected string[]'))
  }
  return merge(...errors)
}

export function validateStageTransitionBody(x: unknown): ValidationResult {
  if (!isObject(x)) return fail('body: expected object')
  const errors: ValidationResult[] = [
    requireField('body', x, 'workflow_instance_oid', isString, 'string'),
    requireField('body', x, 'from_stage_id', isString, 'string'),
    requireField('body', x, 'to_stage_id', isString, 'string'),
    requireField('body', x, 'trigger_reason',
      isOneOf([
        'listen_matched', 'timeout', 'action_completed', 'action_failed',
        'precondition_passed', 'precondition_failed',
        'invocation_succeeded', 'invocation_failed',
        'external_signal', 'cleanup',
      ] as const),
      'StageTransitionReason'),
    requireField('body', x, 'bind_outputs', isObject, 'object'),
    requireField('body', x, 'transitioned_at_ms', isInteger, 'integer'),
  ]
  if (!('previous_transition_oid' in x)) {
    errors.push(fail('body.previous_transition_oid: missing required field'))
  } else if (x['previous_transition_oid'] !== null && !isString(x['previous_transition_oid'])) {
    errors.push(fail('body.previous_transition_oid: expected string | null'))
  }
  if (x['triggering_event_oid'] !== undefined) {
    errors.push(requireField('body', x, 'triggering_event_oid', isString, 'string'))
  }
  if (x['triggering_invocation_oid'] !== undefined) {
    errors.push(requireField('body', x, 'triggering_invocation_oid', isString, 'string'))
  }
  return merge(...errors)
}

export function validateChannelEventBody(x: unknown): ValidationResult {
  if (!isObject(x)) return fail('body: expected object')
  const errors: ValidationResult[] = [
    requireField('body', x, 'channel', isString, 'string'),
    requireField('body', x, 'event_kind', isString, 'string'),
    requireField('body', x, 'payload', isObject, 'object'),
    requireField('body', x, 'observed_at_ms', isInteger, 'integer'),
  ]
  if (x['workflow_instance_oid'] !== undefined) {
    errors.push(requireField('body', x, 'workflow_instance_oid', isString, 'string'))
  }
  if (x['stage_id'] !== undefined) {
    errors.push(requireField('body', x, 'stage_id', isString, 'string'))
  }
  return merge(...errors)
}

export function validateGapDecisionReceiptBody(x: unknown): ValidationResult {
  if (!isObject(x)) return fail('body: expected object')
  const errors: ValidationResult[] = [
    requireField('body', x, 'subject_kind',
      isOneOf([
        'capability_invocation', 'stage_transition', 'grant_issued', 'grant_revoked',
        'workflow_started', 'workflow_terminated', 'revocation_initiated',
        'revocation_effective', 'federation_handshake', /* reserved for GAP 1.1 */ 'provisional_block',
      ] as const),
      'DecisionSubjectKind'),
    requireField('body', x, 'subject_oid', isString, 'string'),
    requireField('body', x, 'status',
      isOneOf(['ok', 'denied', 'failed', 'deferred', 'timed_out', 'pending'] as const),
      'DecisionStatus'),
    requireField('body', x, 'initiated_at_ms', isInteger, 'integer'),
    requireField('body', x, 'resolved_at_ms', isInteger, 'integer'),
  ]
  if (!isObject(x['initiator'])) {
    errors.push(fail('body.initiator: expected object'))
  } else {
    errors.push(
      requireField('body.initiator', x['initiator'], 'actor_oid', isString, 'string'),
      requireField('body.initiator', x['initiator'], 'actor_type', isActorType, 'GapActorType'),
    )
  }
  if (x['detail'] !== undefined) errors.push(requireField('body', x, 'detail', isString, 'string'))
  if (x['capability_grant_oids'] !== undefined) {
    if (!isArray(x['capability_grant_oids']) || !x['capability_grant_oids'].every(isString)) {
      errors.push(fail('body.capability_grant_oids: expected string[]'))
    }
  }
  if (x['channel_event_oids'] !== undefined) {
    if (!isArray(x['channel_event_oids']) || !x['channel_event_oids'].every(isString)) {
      errors.push(fail('body.channel_event_oids: expected string[]'))
    }
  }
  if (x['compliance_tags'] !== undefined) {
    if (!isArray(x['compliance_tags']) || !x['compliance_tags'].every(isString)) {
      errors.push(fail('body.compliance_tags: expected string[]'))
    }
  }
  if (x['signer_identity'] !== undefined) {
    if (!isObject(x['signer_identity'])) {
      errors.push(fail('body.signer_identity: expected object'))
    } else {
      const si = x['signer_identity']
      errors.push(requireField('body.signer_identity', si, 'display_name', isString, 'string'))
      errors.push(optionalField('body.signer_identity', si, 'role', isString, 'string'))
      errors.push(optionalField('body.signer_identity', si, 'credential_id', isString, 'string'))
    }
  }
  // C8: sub-millisecond sequence fields
  if (x['sequence_number'] !== undefined) {
    errors.push(optionalField('body', x, 'sequence_number',
      (v): v is number => isNumber(v) && Number.isInteger(v) && (v as number) >= 0,
      'non-negative integer'))
  }
  if (x['decided_at_ns'] !== undefined) {
    errors.push(optionalField('body', x, 'decided_at_ns', isInteger, 'integer'))
  }
  // Item 3: token_consumption
  if (x['token_consumption'] !== undefined) {
    errors.push(validateTokenConsumption(x['token_consumption']))
  }
  // [0024]: measured result block
  if (x['measured'] !== undefined) {
    errors.push(validateMeasuredResult(x['measured']))
  }
  return merge(...errors)
}

export function validateRevocationEventBody(x: unknown): ValidationResult {
  if (!isObject(x)) return fail('body: expected object')
  const errors: ValidationResult[] = [
    requireField('body', x, 'target_kind',
      isOneOf([
        'capability_declaration', 'capability_grant',
        'workflow_definition', 'workflow_instance', 'skill',
      ] as const),
      'RevocationTargetKind'),
    requireField('body', x, 'target_oid', isString, 'string'),
    requireField('body', x, 'reason', isString, 'string'),
    requireField('body', x, 'provisional', isBoolean, 'boolean'),
  ]
  if (x['required_level'] !== 1 && x['required_level'] !== 2 && x['required_level'] !== 3) {
    errors.push(fail('body.required_level: expected 1 | 2 | 3'))
  }
  if (!isArray(x['approvers'])) {
    errors.push(fail('body.approvers: expected array'))
  } else {
    x['approvers'].forEach((a, i) => {
      if (!isObject(a)) {
        errors.push(fail(`body.approvers[${i}]: expected object`))
        return
      }
      errors.push(
        requireField(`body.approvers[${i}]`, a, 'actor_oid', isString, 'string'),
        requireField(`body.approvers[${i}]`, a, 'approved_at_ms', isInteger, 'integer'),
        requireField(`body.approvers[${i}]`, a, 'cooling_off_satisfied', isBoolean, 'boolean'),
      )
    })
  }
  if (!('effective_at_ms' in x)) {
    errors.push(fail('body.effective_at_ms: missing required field'))
  } else if (x['effective_at_ms'] !== null && !isNumber(x['effective_at_ms'])) {
    errors.push(fail('body.effective_at_ms: expected number | null'))
  }
  if (x['evidence_oids'] !== undefined) {
    if (!isArray(x['evidence_oids']) || !x['evidence_oids'].every(isString)) {
      errors.push(fail('body.evidence_oids: expected string[]'))
    }
  }
  if (x['provisional_block_policy'] !== undefined) {
    if (!isObject(x['provisional_block_policy'])) {
      errors.push(fail('body.provisional_block_policy: expected object'))
    } else {
      const pbp = x['provisional_block_policy']
      if (pbp['on_expiry_without_quorum'] !== 'renew' && pbp['on_expiry_without_quorum'] !== 'revert') {
        errors.push(fail('body.provisional_block_policy.on_expiry_without_quorum: expected "renew" | "revert"'))
      }
      // M-5: optional TTL override; minimum 1 hour
      if (pbp['provisional_block_ttl_ms'] !== undefined) {
        const minTtl = 3_600_000
        if (!isInteger(pbp['provisional_block_ttl_ms']) || (pbp['provisional_block_ttl_ms'] as number) < minTtl) {
          errors.push(fail('body.provisional_block_policy.provisional_block_ttl_ms: expected integer >= 3600000 (1 hour)'))
        }
      }
    }
  }
  if (x['min_approvers'] !== undefined) {
    const isPositiveInteger = (v: unknown): v is number =>
      isNumber(v) && Number.isInteger(v) && (v as number) > 0
    if (!isPositiveInteger(x['min_approvers'])) {
      errors.push(fail('body.min_approvers: expected positive integer'))
    }
  }
  return merge(...errors)
}

// -- Full-envelope validators (envelope + body) ------------------------------

export function validateCapabilityDeclaration(x: unknown): ValidationResult {
  const env = validateEnvelopeShape(x, 'gap:capability_declaration')
  if (!env.ok) return env
  return merge(env, validateCapabilityDeclarationBody((x as GapCdroEnvelope<unknown>).body))
}

export function validateCapabilityGrant(x: unknown): ValidationResult {
  const env = validateEnvelopeShape(x, 'gap:capability_grant')
  if (!env.ok) return env
  return merge(env, validateCapabilityGrantBody((x as GapCdroEnvelope<unknown>).body))
}

export function validateCapabilityInvocation(x: unknown): ValidationResult {
  const env = validateEnvelopeShape(x, 'gap:capability_invocation')
  if (!env.ok) return env
  return merge(env, validateCapabilityInvocationBody((x as GapCdroEnvelope<unknown>).body))
}

export function validateWorkflowDefinition(x: unknown): ValidationResult {
  const env = validateEnvelopeShape(x, 'gap:workflow_definition')
  if (!env.ok) return env
  return merge(env, validateWorkflowDefinitionBody((x as GapCdroEnvelope<unknown>).body))
}

export function validateWorkflowInstance(x: unknown): ValidationResult {
  const env = validateEnvelopeShape(x, 'gap:workflow_instance')
  if (!env.ok) return env
  return merge(env, validateWorkflowInstanceBody((x as GapCdroEnvelope<unknown>).body))
}

export function validateStageTransition(x: unknown): ValidationResult {
  const env = validateEnvelopeShape(x, 'gap:stage_transition')
  if (!env.ok) return env
  return merge(env, validateStageTransitionBody((x as GapCdroEnvelope<unknown>).body))
}

export function validateChannelEvent(x: unknown): ValidationResult {
  const env = validateEnvelopeShape(x, 'gap:channel_event')
  if (!env.ok) return env
  return merge(env, validateChannelEventBody((x as GapCdroEnvelope<unknown>).body))
}

export function validateGapDecisionReceipt(x: unknown): ValidationResult {
  const env = validateEnvelopeShape(x, 'gap:decision_receipt')
  if (!env.ok) return env
  return merge(env, validateGapDecisionReceiptBody((x as GapCdroEnvelope<unknown>).body))
}

export function validateRevocationEvent(x: unknown): ValidationResult {
  const env = validateEnvelopeShape(x, 'gap:revocation_event')
  if (!env.ok) return env
  return merge(env, validateRevocationEventBody((x as GapCdroEnvelope<unknown>).body))
}

// -- Full-envelope validators for new CDRO types (Items 1, 4, 7) -------------

export function validateOrchestrationChain(x: unknown): ValidationResult {
  const env = validateEnvelopeShape(x, 'gap:orchestration_chain')
  if (!env.ok) return env
  return merge(env, validateOrchestrationChainBody((x as GapCdroEnvelope<unknown>).body))
}

export function validateConsentRecord(x: unknown): ValidationResult {
  const env = validateEnvelopeShape(x, 'gap:consent_record')
  if (!env.ok) return env
  return merge(env, validateConsentRecordBody((x as GapCdroEnvelope<unknown>).body))
}

export function validatePipResponse(x: unknown): ValidationResult {
  const env = validateEnvelopeShape(x, 'gap:pip_response')
  if (!env.ok) return env
  return merge(env, validatePipResponseBody((x as GapCdroEnvelope<unknown>).body))
}

// -- Note on imports ---------------------------------------------------------
// The CapabilityDeclaration / CapabilityGrant / ... type imports above are
// used only at the .d.ts level (validators take `unknown`); the underscore
// guards below silence "unused" lint without changing emit.
type _Unused =
  | CapabilityDeclaration
  | CapabilityDeclarationBody
  | CapabilityGrant
  | CapabilityGrantBody
  | CapabilityInvocation
  | CapabilityInvocationBody
  | WorkflowDefinition
  | WorkflowDefinitionBody
  | WorkflowInstance
  | WorkflowInstanceBody
  | StageTransition
  | StageTransitionBody
  | ChannelEvent
  | ChannelEventBody
  | GapDecisionReceipt
  | GapDecisionReceiptBody
  | RevocationEvent
  | RevocationEventBody
  | Capability
  | CapabilityPredicate
  | GrantedCapabilityScope
  // New types from Items 1-7
  | ConsentRecordBody
  | CredentialKind
  | DelegationStep
  | IdentityBinding
  | McpToolCallContext
  | OrchestrationChainBody
  | PipResponseBody
  | TokenBudgetArgs
  | ExternalPipArgs
  | TokenConsumption
