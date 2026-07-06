/**
 * test/oid.test.ts -- computeGapOid stability and cross-call consistency.
 *
 * V1/V2/V3 are fixed test vectors with gap: type prefixes. They are computed
 * once at load time and then checked for stability across repeated calls.
 * Any change to the canonical form (key sort, null handling, exclusion set)
 * will break these tests -- that is intentional.
 *
 * The null/absent regression guards at the bottom are the cross-language
 * parity guards: the TypeScript and Python SDKs must both produce a DIFFERENT
 * OID when a field is explicitly null vs simply absent.
 */

import { computeGapOid, canonicalize } from '../src/index.js'

let passed = 0, failed = 0
function ok(label: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; process.stdout.write(`OK   ${label}\n`) }
  else      { failed++; process.stdout.write(`FAIL ${label}${detail ? ' - ' + detail : ''}\n`) }
}

// Three fixed test vectors with gap: type prefix.

const V1 = {
  type: 'gap:capability_declaration',
  tenant_id: 'tenant-vector-1',
  created_at_ms: 1700000000000,
  created_by: 'actor:operator',
  body: {
    actor_type: 'skill',
    actor_id: 'skill:demo',
    actor_name: 'Demo',
    actor_version: '1.0.0',
    capabilities: [{ capability: 'demo.say_hello' }],
  },
}
const V1_OID = computeGapOid(V1)

const V2 = {
  type: 'gap:capability_grant',
  tenant_id: 'tenant-vector-2',
  created_at_ms: 1700000001000,
  created_by: 'actor:operator',
  body: {
    grantee: { actor_type: 'skill', actor_oid: 'actor:abc' },
    capability_scopes: [{ capability: 'demo.*' }],
    granted_at_ms: 1700000001000,
    expires_at_ms: null,
    granted_by: 'actor:operator',
  },
}
const V2_OID = computeGapOid(V2)

const V3 = {
  type: 'gap:capability_invocation',
  tenant_id: 'tenant-vector-3',
  created_at_ms: 1700000002000,
  created_by: 'actor:abc',
  body: {
    caller: { actor_type: 'skill', actor_oid: 'actor:abc', grant_oid: 'sha256:deadbeef' },
    capability: 'demo.say_hello',
    capability_declaration_oid: 'sha256:cafebabe',
    args: { greeting: 'hello' },
    invoked_at_ms: 1700000002000,
  },
}
const V3_OID = computeGapOid(V3)

// -- Determinism -------------------------------------------------------------

ok('computeGapOid: deterministic for V1', computeGapOid(V1) === computeGapOid(V1))
ok('computeGapOid: deterministic for V2', computeGapOid(V2) === computeGapOid(V2))
ok('computeGapOid: deterministic for V3', computeGapOid(V3) === computeGapOid(V3))

// -- Stable across calls -----------------------------------------------------

const v1Actual = computeGapOid(V1)
ok('computeGapOid: V1 stable', v1Actual === V1_OID,
   `expected ${V1_OID}, got ${v1Actual}`)

const v2Actual = computeGapOid(V2)
ok('computeGapOid: V2 stable', v2Actual === V2_OID,
   `expected ${V2_OID}, got ${v2Actual}`)

const v3Actual = computeGapOid(V3)
ok('computeGapOid: V3 stable', v3Actual === V3_OID,
   `expected ${V3_OID}, got ${v3Actual}`)

// -- Key-order independence --------------------------------------------------

const V1_REORDERED = {
  body: V1.body,
  tenant_id: V1.tenant_id,
  type: V1.type,
  created_by: V1.created_by,
  created_at_ms: V1.created_at_ms,
}
ok('computeGapOid: key order in input does not affect hash',
   computeGapOid(V1_REORDERED) === V1_OID)

// -- undefined fields are dropped --------------------------------------------

const V1_WITH_UNDEFINED = { ...V1, ignored_field: undefined }
ok('computeGapOid: undefined fields are dropped from canonical form',
   computeGapOid(V1_WITH_UNDEFINED) === V1_OID)

// -- canonicalize directly ---------------------------------------------------

ok('canonicalize: scalar passthrough',
   canonicalize('hello') === '"hello"')
ok('canonicalize: null passthrough',
   canonicalize(null) === 'null')
ok('canonicalize: array preserves order',
   canonicalize([3, 1, 2]) === '[3,1,2]')
ok('canonicalize: sorts object keys',
   canonicalize({ b: 2, a: 1 }) === '{"a":1,"b":2}')
ok('canonicalize: drops undefined values',
   canonicalize({ a: 1, b: undefined, c: 3 }) === '{"a":1,"c":3}')
ok('canonicalize: nested objects keep sort order',
   canonicalize({ z: { y: 1, x: 2 }, a: 1 }) === '{"a":1,"z":{"x":2,"y":1}}')

// -- null values in objects are KEPT (RFC 8785 JCS) -------------------------
// Cross-language golden rule: null != absent. A present-null key serializes as
// JSON null and CHANGES the OID relative to the key being absent. This matches
// SRAID (the normative canonicalize source) and is the only behavior that keeps
// gateway-minted OIDs verifiable by the gap SDK.

ok('canonicalize: null values in objects are kept as JSON null',
   canonicalize({ a: 1, b: null, c: 3 }) === '{"a":1,"b":null,"c":3}')
ok('canonicalize: null values in nested objects are kept as JSON null',
   canonicalize({ outer: { a: 1, b: null } }) === '{"outer":{"a":1,"b":null}}')
ok('canonicalize: null in array is kept as JSON null',
   canonicalize([1, null, 3]) === '[1,null,3]')

// -- non-ASCII strings emitted as UTF-8, not \uXXXX (cross-language golden) --
// JavaScript JSON.stringify emits non-ASCII as literal UTF-8 bytes.
// Python json.dumps with ensure_ascii=True (the default) emits \uXXXX escapes.
// The Python SDK MUST use ensure_ascii=False so both produce identical bytes.
// These vectors are the regression guard: if Python regresses to \uXXXX escapes,
// it will produce different OIDs from this TypeScript implementation.

ok('canonicalize: non-ASCII string emitted as UTF-8 literal, not \\uXXXX',
   canonicalize({ emoji: '🚀', s: 'é' }) === '{"emoji":"🚀","s":"é"}')
ok('canonicalize: non-ASCII object key emitted as UTF-8 literal',
   canonicalize({ 'café': 1 }) === '{"café":1}')

const WITH_NULL_BODY = {
  type: 'gap:capability_grant',
  tenant_id: 'xtest',
  created_at_ms: 1,
  created_by: 'actor:a',
  body: { a: 1, expires_at_ms: null },
}
const WITHOUT_NULL_BODY = {
  type: 'gap:capability_grant',
  tenant_id: 'xtest',
  created_at_ms: 1,
  created_by: 'actor:a',
  body: { a: 1 },
}
ok('computeGapOid: explicit null field produces DIFFERENT OID from absent field (regression guard)',
   computeGapOid(WITH_NULL_BODY) !== computeGapOid(WITHOUT_NULL_BODY))

// -- B1: the SIX detached-signature fields strip to the same OID (ADR_019) ----
// The normative content-core projection (PROJECTION_SPEC.md §2) removes EXACTLY
// oid, signature, ml_dsa_signature, signature_key_id, signature_algorithm,
// attestation. A post-attestation envelope carrying all six must produce the
// SAME OID as the pre-attestation object without them (the keystone
// pre/post-attestation invariance).

const CONTENT_CORE = {
  type: 'gap:decision_receipt',
  sraid_version: '2.0',
  gap_version: '1.0',
  tenant_id: 'tenant-b1',
  created_at_ms: 1700000010000,
  created_by: 'actor:operator',
  body: { decision: 'allow', amount_minor: 1299 },
  supersedes: 'sha256:' + 'b'.repeat(64),
}
const POST_ATTESTATION = {
  ...CONTENT_CORE,
  oid: 'sha256:' + 'a'.repeat(64),
  signature: 'sig-placeholder',
  ml_dsa_signature: 'mldsa-placeholder',
  signature_key_id: 'key-placeholder',
  signature_algorithm: 'ed25519+ml-dsa-65',
  attestation: { payloadType: 'application/vnd.synoi.gap+json', payload: '{}', signatures: [] },
}
ok('computeGapOid: post-attestation envelope strips the six detached fields to the same OID as pre-attestation',
   computeGapOid(POST_ATTESTATION) === computeGapOid(CONTENT_CORE))

// -- B1b: gap_version and supersedes are KEPT in identity (ADR_019) -----------
// Unlike the old 5-field strip, gap_version and supersedes are now hashed into
// the OID: changing either changes the OID (protocol-downgrade detection and
// Merkle-DAG lineage tamper-evidence).

ok('computeGapOid: changing gap_version changes the OID (kept in identity)',
   computeGapOid({ ...CONTENT_CORE, gap_version: '2.0' }) !== computeGapOid(CONTENT_CORE))
ok('computeGapOid: changing supersedes changes the OID (kept in identity)',
   computeGapOid({ ...CONTENT_CORE, supersedes: 'sha256:' + 'c'.repeat(64) }) !== computeGapOid(CONTENT_CORE))

// -- B1c: matches the shared ADR_019 keystone vector --------------------------
// The exact object from PROJECTION_SPEC.md §2.3 must yield the shipped OID that
// the live v2 signer stamps and @synoi/sraid computes.

const ADR019_KEYSTONE = {
  type: 'gap:decision_receipt',
  sraid_version: '2.0',
  gap_version: '1.0',
  tenant_id: 'tenant-x',
  created_at_ms: 1720000000000,
  created_by: 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
  body: { decision: 'allow', amount_minor: 1299 },
  authority: { grant_oid: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', decision: 'allow' },
  supersedes: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
}
ok('computeGapOid: ADR_020 keystone vector yields the shipped sraid OID sha256:d1d5d5c5...',
   computeGapOid(ADR019_KEYSTONE) === 'sha256:d1d5d5c51d2d5f80470089ff10b8b642e19fc76db6be298f4f346616528a087a',
   `got ${computeGapOid(ADR019_KEYSTONE)}`)

// -- B2: float rejection in canonicalize -------------------------------------

ok('canonicalize: throws on float', (() => {
  try { canonicalize(1.5); return false } catch(e) { return true }
})())
ok('canonicalize: throws on NaN', (() => {
  try { canonicalize(NaN); return false } catch(e) { return true }
})())
ok('canonicalize: throws on Infinity', (() => {
  try { canonicalize(Infinity); return false } catch(e) { return true }
})())
ok('canonicalize: integer number passes through', canonicalize(42) === '42')
ok('canonicalize: zero passes through', canonicalize(0) === '0')
ok('canonicalize: negative integer passes through', canonicalize(-100) === '-100')

process.stdout.write(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed > 0 ? 1 : 0)
