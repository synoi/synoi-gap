// scripts/gen-conformance-vectors.ts -- regenerate CONFORMANCE_VECTORS.json
// from the actual shipping code (src/oid.ts computeGapOid + src/canonicalize.ts
// canonicalize). Run with: npx tsx scripts/gen-conformance-vectors.ts
//
// Why this exists (ADR_019 drift, fixed here): the checked-in
// CONFORMANCE_VECTORS.json was hand-authored against the PRE-ADR_019
// five-field strip set (oid, gap_version, signature, signature_key_id,
// supersedes). The shipping projection (src/oid.ts CDRO_ENVELOPE_FIELDS,
// confirmed by test/oid.test.ts:198-201 and test/conformance.test.ts:273-281)
// strips exactly six DETACHED fields and KEEPS gap_version + supersedes in
// identity. None of the four original vector inputs happen to carry
// gap_version or supersedes, so their OIDs are numerically unchanged by the
// fix -- but the file's excluded_fields metadata and its adr019_note were
// actively WRONG, and the file did not contain any vector that exercises the
// one behavior ADR_019 changed. This script is now the single source of
// truth for the file: never hand-edit an OID in CONFORMANCE_VECTORS.json
// again -- edit the vector inputs here and re-run.
//
// NO-VECTOR-NO-CLAIM: every OID below is computed by calling the real
// src/oid.ts computeGapOid at generation time, not transcribed by hand.

import { writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { computeGapOid, canonicalize } from '../src/index.js'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..')
const outPath = join(repoRoot, 'CONFORMANCE_VECTORS.json')

// The six detached-signature / envelope fields computeGapOid strips before
// hashing (src/oid.ts CDRO_ENVELOPE_FIELDS). This is the ONE normative
// strip-set; gap_version and supersedes are deliberately ABSENT from this
// list because ADR_019 keeps them in identity.
const EXCLUDED_FIELDS = [
  'oid',
  'signature',
  'ml_dsa_signature',
  'signature_key_id',
  'signature_algorithm',
  'attestation',
]

interface Vector {
  id: string
  description: string
  input: unknown
  excluded_fields: string[]
  canonical: string
  oid: string
  note?: string
}

function buildVector(id: string, description: string, input: unknown, note?: string): Vector {
  return {
    id,
    description,
    input,
    excluded_fields: EXCLUDED_FIELDS,
    // None of these inputs carry any of the six detached fields, so the
    // canonical form is canonicalize(input) directly (no stripping applies).
    canonical: canonicalize(input),
    oid: computeGapOid(input),
    ...(note ? { note } : {}),
  }
}

const vectors: Vector[] = [
  buildVector(
    'V_DECL',
    'gap:capability_declaration - basic actor declaration',
    {
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
    },
  ),
  buildVector(
    'V_GRANT',
    'gap:capability_grant - grant with null expiry (null MUST be kept per RFC 8785 JCS)',
    {
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
    },
  ),
  buildVector(
    'V_INV',
    'gap:capability_invocation',
    {
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
    },
  ),
  buildVector(
    'V_NON_ASCII',
    'Non-ASCII strings must be UTF-8 literals not escape sequences',
    {
      type: 'gap:capability_declaration',
      tenant_id: 't1',
      created_at_ms: 1,
      created_by: 'actor:test',
      body: { emoji: '🚀', s: 'é' },
    },
  ),
  buildVector(
    'V_ADR019_IDENTITY',
    'gap:decision_receipt carrying gap_version + supersedes - proves both are KEPT in identity ' +
      '(ADR_019): they are NOT in excluded_fields, so they are hashed into the OID, and changing ' +
      'either one changes the OID (protocol-downgrade detection / Merkle-DAG lineage tamper-evidence).',
    {
      type: 'gap:decision_receipt',
      gap_version: '1.0',
      tenant_id: 'tenant-adr019-1',
      created_at_ms: 1700000010000,
      created_by: 'actor:operator',
      body: { decision: 'allow', amount_minor: 1299 },
      supersedes: 'sha256:' + 'b'.repeat(64),
    },
    'This vector is the regression guard for the excluded_fields list above: recomputing this ' +
      'input with gap_version or supersedes changed (or removed) MUST yield a DIFFERENT oid. See ' +
      'test/oid.test.ts B1b and test/conformance.test.ts (gap_version / supersedes KEPT) for the ' +
      'executable form of this same assertion.',
  ),
]

const doc = {
  version: '1.0',
  description: 'Cross-language OID parity vectors for GAP 1.0. Implementations in any language must produce these exact sha256 hex values for these inputs.',
  note: 'All string values containing non-ASCII characters must be emitted as UTF-8 byte sequences, not Unicode escape sequences (ensure_ascii=False in Python, JSON.stringify native in JavaScript).',
  adr019_note: 'REGENERATED (ADR_019, Wave 2 complete). excluded_fields below is the current six-field detached-signature strip set (src/oid.ts CDRO_ENVELOPE_FIELDS): oid, signature, ml_dsa_signature, signature_key_id, signature_algorithm, attestation. gap_version and supersedes are KEPT in identity and hashed into the OID (PROJECTION_SPEC.md decisions 1-3). This file is generated by scripts/gen-conformance-vectors.ts directly from computeGapOid; do not hand-edit it. These OIDs are normative and are exercised by the ADR_019 cross-language projection gate in synoi-conformance (scripts/adr019-projection-gate.ts).',
  generated_by: 'scripts/gen-conformance-vectors.ts',
  vectors,
}

writeFileSync(outPath, JSON.stringify(doc, null, 2) + '\n')
process.stdout.write(`Wrote ${outPath}\n`)
process.stdout.write(`  ${vectors.length} vectors, excluded_fields = [${EXCLUDED_FIELDS.join(', ')}]\n`)
for (const v of vectors) {
  process.stdout.write(`  ${v.id.padEnd(20)} ${v.oid}\n`)
}
