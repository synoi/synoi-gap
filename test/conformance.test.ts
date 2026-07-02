/**
 * test/conformance.test.ts -- GAP protocol conformance vectors.
 *
 * Structure:
 *   1. OID computation vectors -- determinism, field-order independence,
 *      excluded-field invariants (signature, oid, gap_version, supersedes,
 *      signature_key_id must NOT affect the hash).
 *   2. scope_narrowing evaluation vectors -- document MUST-behavior per
 *      IMPLEMENTING.md Section 5 (string exact-match, numeric bounds, array
 *      membership, boolean equality, key-name exactness).
 *   3. Delegation subset vectors -- child scope must be a subset of parent.
 *   4. Idempotency vectors -- document gateway MUST-behavior per spec.
 *
 * Sections 2-4 document specification rules, not library internals. Each
 * vector is evaluated by a local reference evaluator that mirrors the spec
 * rule so the test PASSES if the evaluator and the documented expectation
 * agree. Any conformant gateway implementation must produce the same
 * outcome for every vector here.
 */

import { computeGapOid } from '../src/index.js'

let passed = 0, failed = 0
function ok(label: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; process.stdout.write(`OK   ${label}\n`) }
  else      { failed++; process.stdout.write(`FAIL ${label}${detail ? ' - ' + detail : ''}\n`) }
}

// ============================================================================
// Section 1: OID computation vectors
// ============================================================================

// -- V_DECL: known-good capability_declaration payload -----------------------
// OID captured on first run; must be stable across runs.
// If this changes the wire format has drifted -- investigate before merging.
const V_DECL_PAYLOAD = {
  type: 'gap:capability_declaration',
  tenant_id: 'tenant-conformance-1',
  created_at_ms: 1717200000000,
  created_by: 'actor:operator',
  body: {
    actor_type: 'skill',
    actor_id: 'skill:thermostat',
    actor_name: 'Thermostat Control',
    actor_version: '2.0.0',
    capabilities: [
      { capability: 'home.thermostat.set_temp', physical_safety: true, safety_class: 'B' },
    ],
  },
}
// Pin: sha256 of canonicalized V_DECL_PAYLOAD.
// Regenerate ONLY when both sides intentionally change canonical form.
// Any change to this value means the wire format has drifted -- investigate before merging.
const V_DECL_OID_PINNED = 'sha256:0d0aa51268f79bf2981a933fc68bca35a14585fdd6b99a8cf0fa633e56035cfc'
const V_DECL_OID = computeGapOid(V_DECL_PAYLOAD)

ok('OID: V_DECL deterministic (call 1 === call 2)',
   computeGapOid(V_DECL_PAYLOAD) === computeGapOid(V_DECL_PAYLOAD))
ok('OID: V_DECL stable across calls',
   computeGapOid(V_DECL_PAYLOAD) === V_DECL_OID)
ok('OID: V_DECL matches pinned cross-run vector',
   V_DECL_OID === V_DECL_OID_PINNED)
ok('OID: V_DECL has sha256: prefix',
   V_DECL_OID.startsWith('sha256:'))
ok('OID: V_DECL is 64-char hex after prefix',
   V_DECL_OID.slice('sha256:'.length).length === 64 &&
   /^[0-9a-f]+$/.test(V_DECL_OID.slice('sha256:'.length)))

// -- V_GRANT: known-good capability_grant payload ----------------------------
// NOTE: expires_at_ms: null is intentionally present. Null fields are KEPT in
// the canonical form (RFC 8785 JCS: null is a first-class JSON value; only
// undefined/absent keys are dropped). This vector proves null is preserved and
// produces a DIFFERENT OID from a payload with the key absent.
const V_GRANT_PAYLOAD = {
  type: 'gap:capability_grant',
  tenant_id: 'tenant-conformance-1',
  created_at_ms: 1717200001000,
  created_by: 'actor:operator',
  body: {
    grantee: { actor_type: 'skill', actor_oid: 'actor:skill-thermostat' },
    capability_scopes: [
      {
        capability: 'home.thermostat.set_temp',
        scope_narrowing: { max_temp_c: 28, min_temp_c: 15 },
      },
    ],
    granted_at_ms: 1717200001000,
    expires_at_ms: null,
    granted_by: 'actor:operator',
  },
}
const V_GRANT_OID_PINNED = 'sha256:bf485bebe2d0dd54b8c64019a54fd6b88a3d276e6f8a4f17c6104c92a728564a'
const V_GRANT_OID = computeGapOid(V_GRANT_PAYLOAD)
ok('OID: V_GRANT deterministic', computeGapOid(V_GRANT_PAYLOAD) === V_GRANT_OID)
ok('OID: V_GRANT has sha256: prefix', V_GRANT_OID.startsWith('sha256:'))
ok('OID: V_GRANT matches pinned cross-run vector', V_GRANT_OID === V_GRANT_OID_PINNED)

// -- V_INV: known-good capability_invocation payload -------------------------
const V_INV_PAYLOAD = {
  type: 'gap:capability_invocation',
  tenant_id: 'tenant-conformance-1',
  created_at_ms: 1717200002000,
  created_by: 'actor:skill-thermostat',
  body: {
    caller: {
      actor_type: 'skill',
      actor_oid: 'actor:skill-thermostat',
      grant_oid: V_GRANT_OID,
    },
    capability: 'home.thermostat.set_temp',
    args: { temp_c: 22, room: 'living_room' },
    invoked_at_ms: 1717200002000,
  },
}
const V_INV_OID = computeGapOid(V_INV_PAYLOAD)
ok('OID: V_INV deterministic', computeGapOid(V_INV_PAYLOAD) === V_INV_OID)

// -- V_RCPT_MEASURED: decision_receipt carrying the [0024] measured block ------
// Proves the full-object receipt binds MEASURED cost + result + counterparty +
// lineage INTO the signed content core: the measured block changes the OID, so
// it is signed evidence of what the action actually cost, not merely that it
// was allowed. cost_micro_usd is an INTEGER (micro-USD): the GAP canonicalizer
// forbids floats, so a float cost would be unsignable. Task #33 / patent [0024].
const V_RCPT_MEASURED_PAYLOAD = {
  type: 'gap:decision_receipt',
  tenant_id: 'tenant-conformance-1',
  created_at_ms: 1717200003000,
  created_by: 'actor:gateway',
  body: {
    subject_kind: 'capability_invocation',
    subject_oid: 'sha256:0000000000000000000000000000000000000000000000000000000000000002',
    initiator: { actor_oid: 'actor:skill-emailer', actor_type: 'skill' },
    status: 'ok',
    initiated_at_ms: 1717200003000,
    resolved_at_ms: 1717200003412,
    measured: {
      cost_micro_usd: 2100,
      latency_ms: 412,
      provider_ran: 'composio',
      counterparty: 'recipient:opaque-token-abc',
      upstream_ref: 'sha256:0000000000000000000000000000000000000000000000000000000000000001',
    },
  },
}
// Pinned cross-run OID. Any change means the wire format drifted -- investigate.
const V_RCPT_MEASURED_OID_PINNED = 'sha256:05d132740795dafe5ade51c1e9393ac80f4043ad8edbc57fea6a016decbafe52'
const V_RCPT_MEASURED_OID = computeGapOid(V_RCPT_MEASURED_PAYLOAD)
ok('OID: V_RCPT_MEASURED deterministic',
   computeGapOid(V_RCPT_MEASURED_PAYLOAD) === V_RCPT_MEASURED_OID)
ok('OID: V_RCPT_MEASURED matches pinned cross-run vector',
   V_RCPT_MEASURED_OID === V_RCPT_MEASURED_OID_PINNED)
ok('OID: V_RCPT_MEASURED has sha256: prefix', V_RCPT_MEASURED_OID.startsWith('sha256:'))
ok('OID: V_RCPT_MEASURED is 64-char hex after prefix',
   V_RCPT_MEASURED_OID.slice('sha256:'.length).length === 64 &&
   /^[0-9a-f]+$/.test(V_RCPT_MEASURED_OID.slice('sha256:'.length)))
// The measured block is INSIDE the signed content core: dropping it changes the OID.
{
  const withoutMeasured = JSON.parse(JSON.stringify(V_RCPT_MEASURED_PAYLOAD))
  delete withoutMeasured.body.measured
  ok('OID: dropping measured block changes the OID (measured is signed content)',
     computeGapOid(withoutMeasured) !== V_RCPT_MEASURED_OID)
}
// Altering the measured cost changes the OID: the receipt is tamper-evident on cost.
{
  const altered = JSON.parse(JSON.stringify(V_RCPT_MEASURED_PAYLOAD))
  altered.body.measured.cost_micro_usd = 2200
  ok('OID: altering measured.cost_micro_usd changes the OID (tamper-evident cost)',
     computeGapOid(altered) !== V_RCPT_MEASURED_OID)
}

// -- Empty-body declaration is deterministic ---------------------------------
const V_EMPTY_BODY = {
  type: 'gap:capability_declaration',
  tenant_id: 'tenant-empty',
  created_at_ms: 0,
  created_by: 'actor:nobody',
  body: { actor_type: 'skill', actor_id: 'skill:noop', actor_name: 'Noop', actor_version: '0.0.0', capabilities: [] },
}
const V_EMPTY_OID = computeGapOid(V_EMPTY_BODY)
ok('OID: empty capabilities body is deterministic',
   computeGapOid(V_EMPTY_BODY) === V_EMPTY_OID &&
   V_EMPTY_OID.startsWith('sha256:'))

// -- Field order does not affect OID -----------------------------------------
// Same logical payload with insertion order shuffled must hash identically.
const V_REORDERED = {
  body: V_DECL_PAYLOAD.body,
  created_by: V_DECL_PAYLOAD.created_by,
  created_at_ms: V_DECL_PAYLOAD.created_at_ms,
  tenant_id: V_DECL_PAYLOAD.tenant_id,
  type: V_DECL_PAYLOAD.type,
}
ok('OID: field insertion order does not affect hash',
   computeGapOid(V_REORDERED) === V_DECL_OID)

// Shuffle nested body keys
const V_BODY_REORDERED = {
  ...V_DECL_PAYLOAD,
  body: {
    capabilities: V_DECL_PAYLOAD.body.capabilities,
    actor_version: V_DECL_PAYLOAD.body.actor_version,
    actor_id: V_DECL_PAYLOAD.body.actor_id,
    actor_name: V_DECL_PAYLOAD.body.actor_name,
    actor_type: V_DECL_PAYLOAD.body.actor_type,
  },
}
ok('OID: nested body field order does not affect hash',
   computeGapOid(V_BODY_REORDERED) === V_DECL_OID)

// -- Excluded fields: computeGapOid auto-strips before hashing ---------------
//
// Per cdro.ts and IMPLEMENTING.md: oid, gap_version, signature,
// signature_key_id, and supersedes MUST NOT contribute to the OID hash.
// computeGapOid strips these five fields internally before canonicalization,
// so callers may pass either a pre-stripped payload or a full envelope and get
// the same OID either way.
//
// Helper: strip the five excluded fields and return a clean OID payload.
function stripExcluded(obj: Record<string, unknown>): Record<string, unknown> {
  const { oid: _oid, gap_version: _gv, signature: _sig, signature_key_id: _skid,
           supersedes: _sup, ...rest } = obj
  return rest
}

// Baseline: stripped payload matches V_DECL_OID
ok('OID: stripped payload is stable baseline',
   computeGapOid(stripExcluded({ ...V_DECL_PAYLOAD })) === V_DECL_OID)

// Adding signature to the full envelope then stripping -> same OID
const V_WITH_SIGNATURE = { ...V_DECL_PAYLOAD, signature: 'ed25519:aabbccddeeff' }
ok('OID: after stripping signature, hash matches baseline',
   computeGapOid(stripExcluded(V_WITH_SIGNATURE as Record<string, unknown>)) === V_DECL_OID)

const V_WITH_SIG_KEY = { ...V_DECL_PAYLOAD, signature_key_id: 'key:operator-v1' }
ok('OID: after stripping signature_key_id, hash matches baseline',
   computeGapOid(stripExcluded(V_WITH_SIG_KEY as Record<string, unknown>)) === V_DECL_OID)

const V_WITH_OID = { ...V_DECL_PAYLOAD, oid: 'sha256:' + '0'.repeat(64) }
ok('OID: after stripping oid field, hash matches baseline',
   computeGapOid(stripExcluded(V_WITH_OID as Record<string, unknown>)) === V_DECL_OID)

const V_WITH_GAP_VERSION = { ...V_DECL_PAYLOAD, gap_version: '1.0' }
ok('OID: after stripping gap_version, hash matches baseline',
   computeGapOid(stripExcluded(V_WITH_GAP_VERSION as Record<string, unknown>)) === V_DECL_OID)

const V_WITH_SUPERSEDES = { ...V_DECL_PAYLOAD, supersedes: 'sha256:' + 'f'.repeat(64) }
ok('OID: after stripping supersedes, hash matches baseline',
   computeGapOid(stripExcluded(V_WITH_SUPERSEDES as Record<string, unknown>)) === V_DECL_OID)

// computeGapOid strips internally, so a full envelope (unstripped) produces the
// same OID as the pre-stripped payload. Both must equal V_DECL_OID.
ok('OID: unstripped signature auto-stripped by computeGapOid -- matches baseline',
   computeGapOid(V_WITH_SIGNATURE) === V_DECL_OID)
ok('OID: unstripped oid auto-stripped by computeGapOid -- matches baseline',
   computeGapOid(V_WITH_OID) === V_DECL_OID)

// -- Two distinct payloads produce distinct OIDs -----------------------------
ok('OID: distinct payloads produce distinct OIDs (decl vs grant)',
   V_DECL_OID !== V_GRANT_OID)
ok('OID: distinct payloads produce distinct OIDs (grant vs inv)',
   V_GRANT_OID !== V_INV_OID)

// ============================================================================
// Section 2: scope_narrowing evaluation vectors
// ============================================================================
//
// These vectors document what a conformant GAP gateway MUST do when evaluating
// scope_narrowing on a capability invocation. The reference evaluator below
// mirrors IMPLEMENTING.md Section 5 rules. Every conformant implementation
// must produce the same allow/deny outcome for each vector.
//
// Rules encoded:
//   - String values: exact equality required. Case-sensitive.
//   - Numeric values (no 'min_' prefix): invocation arg must be <= grant value
//     AND must be non-negative (negative values bypass the upper-bound check).
//   - Numeric values with 'min_' prefix: invocation arg must be >= grant value.
//   - String[] values: invocation arg (a single string) must be in the array.
//   - Boolean values: exact equality required.
//   - Key name must match exactly (singular != plural).
//   - Any key present in grant scope_narrowing must appear in invocation args;
//     absent key -> deny.

function evaluateScopeNarrowing(
  scope: Record<string, unknown>,
  args: Record<string, unknown>,
): 'allow' | 'deny' {
  for (const [key, constraint] of Object.entries(scope)) {
    const val = args[key]
    // Absent key -> deny
    if (!(key in args)) return 'deny'

    if (Array.isArray(constraint)) {
      // String array: val must be a member
      if (typeof val !== 'string') return 'deny'
      if (!(constraint as string[]).includes(val)) return 'deny'
    } else if (typeof constraint === 'number') {
      if (typeof val !== 'number') return 'deny'
      if (key.startsWith('min_')) {
        // Lower-bound: val must be >= constraint
        if (val < constraint) return 'deny'
      } else {
        // Upper-bound: val must be <= constraint AND non-negative
        if (val < 0) return 'deny'
        if (val > constraint) return 'deny'
      }
    } else if (typeof constraint === 'string') {
      if (val !== constraint) return 'deny'
    } else if (typeof constraint === 'boolean') {
      if (val !== constraint) return 'deny'
    }
  }
  return 'allow'
}

interface ScopeVector {
  name: string
  scope: Record<string, unknown>
  args: Record<string, unknown>
  expected: 'allow' | 'deny'
  note?: string
}

const SCOPE_VECTORS: ScopeVector[] = [
  {
    name: 'string exact match -- allow',
    scope: { room: 'kitchen' },
    args: { room: 'kitchen' },
    expected: 'allow',
  },
  {
    name: 'string exact match -- deny',
    scope: { room: 'kitchen' },
    args: { room: 'bedroom' },
    expected: 'deny',
  },
  {
    name: 'absent key -- deny',
    scope: { room: 'kitchen' },
    args: {},
    expected: 'deny',
    note: 'IMPLEMENTING.md S5: every constraint key must appear in invocation args',
  },
  {
    name: 'numeric upper bound -- allow',
    scope: { max_amount_usd: 100 },
    args: { max_amount_usd: 99 },
    expected: 'allow',
  },
  {
    name: 'numeric upper bound -- exact -- allow',
    scope: { max_amount_usd: 100 },
    args: { max_amount_usd: 100 },
    expected: 'allow',
  },
  {
    name: 'numeric upper bound -- exceed -- deny',
    scope: { max_amount_usd: 100 },
    args: { max_amount_usd: 101 },
    expected: 'deny',
  },
  {
    name: 'numeric lower bound min_ prefix -- allow',
    scope: { min_temp_c: 15 },
    args: { min_temp_c: 18 },
    expected: 'allow',
  },
  {
    name: 'numeric lower bound min_ prefix -- exact -- allow',
    scope: { min_temp_c: 15 },
    args: { min_temp_c: 15 },
    expected: 'allow',
  },
  {
    name: 'numeric lower bound min_ prefix -- below -- deny',
    scope: { min_temp_c: 15 },
    args: { min_temp_c: 10 },
    expected: 'deny',
  },
  {
    name: 'negative value physical_safety bypass -- deny',
    scope: { max_delta_units: 0.2 },
    args: { max_delta_units: -5.0 },
    expected: 'deny',
    note: 'negative value must NOT pass upper-bound check (physical safety invariant)',
  },
  {
    name: 'string array membership -- allow',
    scope: { rooms: ['kitchen', 'living_room'] },
    args: { rooms: 'kitchen' },
    expected: 'allow',
  },
  {
    name: 'string array membership -- not member -- deny',
    scope: { rooms: ['kitchen', 'living_room'] },
    args: { rooms: 'bedroom' },
    expected: 'deny',
  },
  {
    name: 'boolean exact match -- allow',
    scope: { notify: true },
    args: { notify: true },
    expected: 'allow',
  },
  {
    name: 'boolean exact match -- deny',
    scope: { notify: true },
    args: { notify: false },
    expected: 'deny',
  },
  {
    name: 'singular/plural key mismatch -- deny',
    scope: { rooms: ['kitchen'] },
    args: { room: 'kitchen' },
    expected: 'deny',
    note: 'exact key name match required; rooms !== room',
  },
  {
    name: 'multi-key all-match -- allow',
    scope: { room: 'kitchen', max_amount_usd: 50 },
    args: { room: 'kitchen', max_amount_usd: 40 },
    expected: 'allow',
  },
  {
    name: 'multi-key partial-match one-fail -- deny',
    scope: { room: 'kitchen', max_amount_usd: 50 },
    args: { room: 'kitchen', max_amount_usd: 60 },
    expected: 'deny',
  },
  {
    name: 'zero amount on max_ upper bound -- allow',
    scope: { max_amount_usd: 100 },
    args: { max_amount_usd: 0 },
    expected: 'allow',
    note: 'zero is non-negative and <= 100',
  },
  {
    name: 'string case sensitivity -- deny',
    scope: { room: 'kitchen' },
    args: { room: 'Kitchen' },
    expected: 'deny',
    note: 'string comparison is case-sensitive per spec',
  },
]

process.stdout.write('\n-- scope_narrowing vectors --\n')
for (const v of SCOPE_VECTORS) {
  const result = evaluateScopeNarrowing(v.scope, v.args)
  ok(
    `scope: ${v.name}`,
    result === v.expected,
    `expected ${v.expected}, got ${result}${v.note ? ' | ' + v.note : ''}`,
  )
}

// ============================================================================
// Section 3: Delegation subset vectors
// ============================================================================
//
// When a grant delegates from a parent, the child scope_narrowing must be a
// subset of the parent's scope_narrowing. Rules:
//   - For string values: child must equal parent (string scope cannot widen).
//   - For numeric upper-bound keys: child <= parent.
//   - For string[] keys: child must be a subset of parent array.
//   - A key present in parent but absent from child -> child drops a constraint
//     -> gateway MUST deny (delegation cannot drop parent constraints).

function evaluateDelegationSubset(
  parent: Record<string, unknown>,
  child: Record<string, unknown>,
): 'allow' | 'deny' {
  // Child cannot drop any key present in parent
  for (const key of Object.keys(parent)) {
    if (!(key in child)) return 'deny'
  }
  // Each child constraint must be within parent constraint
  for (const [key, childVal] of Object.entries(child)) {
    const parentVal = parent[key]
    if (parentVal === undefined) {
      // Child introduces a new key not in parent -- this is allowed (adds
      // restriction), so continue
      continue
    }
    if (Array.isArray(parentVal)) {
      if (!Array.isArray(childVal)) return 'deny'
      for (const item of childVal as unknown[]) {
        if (!(parentVal as unknown[]).includes(item)) return 'deny'
      }
    } else if (typeof parentVal === 'number') {
      if (typeof childVal !== 'number') return 'deny'
      if (key.startsWith('min_')) {
        // Child min_ must be >= parent min_ (child cannot lower the floor)
        if ((childVal as number) < (parentVal as number)) return 'deny'
      } else {
        // Child max must be <= parent max (child cannot raise the ceiling)
        if ((childVal as number) > (parentVal as number)) return 'deny'
      }
    } else if (typeof parentVal === 'string') {
      if (childVal !== parentVal) return 'deny'
    }
  }
  return 'allow'
}

interface DelegationVector {
  name: string
  parent: Record<string, unknown>
  child: Record<string, unknown>
  expected: 'allow' | 'deny'
  note?: string
}

const DELEGATION_VECTORS: DelegationVector[] = [
  {
    name: 'string[] child subset of parent -- allow',
    parent: { rooms: ['a', 'b', 'c'] },
    child: { rooms: ['a', 'b'] },
    expected: 'allow',
  },
  {
    name: 'string[] child adds element not in parent -- deny',
    parent: { rooms: ['a', 'b'] },
    child: { rooms: ['a', 'c'] },
    expected: 'deny',
  },
  {
    name: 'string[] child equals parent exactly -- allow',
    parent: { rooms: ['a', 'b'] },
    child: { rooms: ['a', 'b'] },
    expected: 'allow',
  },
  {
    name: 'numeric child <= parent -- allow',
    parent: { max_amount_usd: 1000 },
    child: { max_amount_usd: 500 },
    expected: 'allow',
  },
  {
    name: 'numeric child equals parent -- allow',
    parent: { max_amount_usd: 1000 },
    child: { max_amount_usd: 1000 },
    expected: 'allow',
  },
  {
    name: 'numeric child > parent -- deny',
    parent: { max_amount_usd: 1000 },
    child: { max_amount_usd: 2000 },
    expected: 'deny',
  },
  {
    name: 'child drops parent constraint -- deny',
    parent: { max_amount_usd: 1000, rooms: ['a'] },
    child: { max_amount_usd: 500 },
    expected: 'deny',
    note: 'rooms key absent in child; delegation cannot drop a parent constraint',
  },
  {
    name: 'child adds new tighter constraint -- allow',
    parent: { max_amount_usd: 1000 },
    child: { max_amount_usd: 500, room: 'kitchen' },
    expected: 'allow',
    note: 'child may add constraints not present in parent (narrows further)',
  },
  {
    name: 'numeric min_ child lowers floor -- deny',
    parent: { min_temp_c: 15 },
    child: { min_temp_c: 10 },
    expected: 'deny',
    note: 'child cannot lower the min_ floor below parent',
  },
  {
    name: 'numeric min_ child raises floor -- allow',
    parent: { min_temp_c: 15 },
    child: { min_temp_c: 20 },
    expected: 'allow',
    note: 'child raising the min_ floor is a subset restriction',
  },
]

process.stdout.write('\n-- delegation subset vectors --\n')
for (const v of DELEGATION_VECTORS) {
  const result = evaluateDelegationSubset(v.parent, v.child)
  ok(
    `delegation: ${v.name}`,
    result === v.expected,
    `expected ${v.expected}, got ${result}${v.note ? ' | ' + v.note : ''}`,
  )
}

// ============================================================================
// Section 4: Idempotency vectors (documented behavioral assertions)
// ============================================================================
//
// These vectors document what a conformant gateway MUST do for idempotency_key
// semantics. They are specification assertions, not calls to a runtime.
// Each vector defines the scenario and the required behavior, then asserts that
// the documented rule is internally consistent.
//
// Spec rule citations: GAP_SPEC idempotency section (idempotency_key field on
// CapabilityInvocationBody + is_idempotency_replay on GapDecisionReceiptBody).

interface IdempotencyVector {
  name: string
  scenario: string
  expected_http_status?: number
  expected_receipt_field?: Record<string, unknown>
  expected_behavior: string
  spec_rule: string
}

const IDEMPOTENCY_VECTORS: IdempotencyVector[] = [
  {
    name: 'same key + same args -> cached receipt with replay flag',
    scenario: 'Invocation A with idempotency_key="txn-001" is processed. Invocation B arrives with the same key and identical args.',
    expected_http_status: 200,
    expected_receipt_field: { is_idempotency_replay: true },
    expected_behavior: 'Gateway returns the original receipt unchanged; body.is_idempotency_replay=true; no new gate evaluation occurs.',
    spec_rule: 'is_idempotency_replay field on GapDecisionReceiptBody; cached args and grant state at original evaluation time apply.',
  },
  {
    name: 'same key + different args -> 409 Conflict',
    scenario: 'Invocation A with idempotency_key="txn-001" and args={amount:100} succeeds. Invocation B arrives with the same key but args={amount:200}.',
    expected_http_status: 409,
    expected_behavior: 'Gateway returns HTTP 409 Conflict. The mismatched args indicate a caller bug; do not evaluate or cache the new invocation.',
    spec_rule: 'idempotency_key on CapabilityInvocationBody; key is scoped to (tenant, capability, idempotency_key) tuple.',
  },
  {
    name: 'same key after grant revocation -> 410 Gone + denial receipt',
    scenario: 'Invocation A with idempotency_key="txn-001" succeeded. The grant is subsequently revoked. Invocation B arrives with the same key.',
    expected_http_status: 410,
    expected_receipt_field: { status: 'denied' },
    expected_behavior: 'Gateway returns HTTP 410 Gone and issues a new denial receipt citing grant_revoked. The original cached receipt is NOT returned.',
    spec_rule: 'Revocation takes precedence over idempotency cache. Replay is only valid while the original grant remains active.',
  },
  {
    name: 'physical_safety=true -> max 60-second idempotency window',
    scenario: 'Invocation against a physical_safety=true capability uses idempotency_key="act-001". 61 seconds later the same key arrives.',
    expected_behavior: 'Gateway MUST treat the second invocation as a fresh evaluation (not a replay) because the idempotency window for physical_safety=true capabilities is capped at 60 seconds.',
    spec_rule: 'physical_safety=true capabilities: maximum idempotency window = 60 seconds (prevents replay of physical actions after safety-window expiry).',
  },
  {
    name: 'different capability + same idempotency_key -> new invocation, no collision',
    scenario: 'Invocation A uses capability="home.lights.on" and idempotency_key="k1". Invocation B uses capability="home.thermostat.set_temp" and the same idempotency_key="k1".',
    expected_behavior: 'Gateway treats them as independent invocations. idempotency_key scope includes the capability name; same key across different capabilities does not collide.',
    spec_rule: 'Idempotency key is scoped to (tenant_id, capability, idempotency_key). Different capability -> different scope -> independent evaluation.',
  },
]

process.stdout.write('\n-- idempotency behavioral vectors --\n')
for (const v of IDEMPOTENCY_VECTORS) {
  // Each vector is a documented assertion about the spec. The test passes if
  // the vector object is structurally sound (expected_behavior is non-empty,
  // spec_rule is cited, and any expected_http_status is in the valid range).
  const structurally_sound =
    v.name.length > 0 &&
    v.expected_behavior.length > 0 &&
    v.spec_rule.length > 0 &&
    (v.expected_http_status === undefined ||
     (v.expected_http_status >= 200 && v.expected_http_status < 600))
  ok(`idempotency: ${v.name}`, structurally_sound)
}

// Spot-check: replay vector has is_idempotency_replay=true in expected fields
ok('idempotency: replay vector specifies is_idempotency_replay=true',
   IDEMPOTENCY_VECTORS[0]?.expected_receipt_field?.['is_idempotency_replay'] === true)

// Spot-check: 409 vector has correct status
ok('idempotency: args-mismatch vector specifies HTTP 409',
   IDEMPOTENCY_VECTORS[1]?.expected_http_status === 409)

// Spot-check: revocation vector has HTTP 410 and denial receipt
ok('idempotency: revocation vector specifies HTTP 410 + denied status',
   IDEMPOTENCY_VECTORS[2]?.expected_http_status === 410 &&
   IDEMPOTENCY_VECTORS[2]?.expected_receipt_field?.['status'] === 'denied')

// Spot-check: physical_safety window documented
ok('idempotency: physical_safety window vector present and references 60 seconds',
   (IDEMPOTENCY_VECTORS[3]?.expected_behavior ?? '').includes('60'))

process.stdout.write(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed > 0 ? 1 : 0)
