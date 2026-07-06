/**
 * oid.ts -- OID computation for GAP CDROs.
 *
 * This is the CDRO OID content-core projection defined normatively in
 * synoi-sraid/PROJECTION_SPEC.md (ADR_019 decisions 1-3). It is DERIVED from
 * that one written source, not re-invented here; a byte-for-byte divergence
 * from the reference implementation (@synoi/sraid src/oid.ts) is
 * non-conformant and is caught by the shared conformance vectors.
 *
 *     OID = "sha256:" + hex(sha256(canonicalize(cdroContentCore(object))))
 *
 * cdroContentCore removes EXACTLY the six detached-signature / envelope fields
 * (see CDRO_ENVELOPE_FIELDS) at the top level and KEEPS everything else -- in
 * particular gap_version and supersedes are KEPT and hashed into identity, so
 * a protocol downgrade or a lineage-edge tamper changes the OID. This is the
 * one projection that yields the SAME OID whether the object is pre- or
 * post-attestation, which is what lets a third party recompute the OID of a
 * SIGNED receipt and match the value the signer stamped.
 */

import { sha256 } from '@noble/hashes/sha256'
import { canonicalize } from './canonicalize.js'

/** Convert a Uint8Array to a lowercase hex string. */
function bytesToHex(bytes: Uint8Array): string {
  const hex: string[] = []
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] as number
    hex.push((b >>> 4).toString(16))
    hex.push((b & 0x0f).toString(16))
  }
  return hex.join('')
}

/**
 * The detached-signature / envelope fields removed by `cdroContentCore` before
 * hashing. This is the ONE normative strip-set for the CDRO OID projection
 * (ADR_019 decision 1; PROJECTION_SPEC.md §2). It is derived from the reference
 * implementation @synoi/sraid `CDRO_ENVELOPE_FIELDS`, NOT independently
 * hand-listed.
 *
 * The set is SEMANTIC: "every field produced BY the signer after
 * canonicalization, plus the OID output itself." Concretely:
 *
 *   oid                  - the projection OUTPUT (cannot be an input to itself)
 *   signature            - legacy hybrid SignatureEnvelope (attaches after hash)
 *   ml_dsa_signature     - detached PQ signature (attaches after hash)
 *   signature_key_id     - signer-stamped key id (produced by the signer)
 *   signature_algorithm  - signer-stamped alg id (produced by the signer)
 *   attestation          - DSSE AttestationEnvelope (attaches after hash)
 *
 * EVERYTHING ELSE IS KEPT and hashed into identity, including in particular
 * `gap_version` (so a protocol downgrade is OID-detectable) and `supersedes`
 * (so the SRAID Merkle-DAG lineage edge is tamper-evident).
 */
const CDRO_ENVELOPE_FIELDS = Object.freeze([
  'oid',
  'signature',
  'ml_dsa_signature',
  'signature_key_id',
  'signature_algorithm',
  'attestation',
])

const CDRO_ENVELOPE_FIELD_SET: ReadonlySet<string> = new Set(CDRO_ENVELOPE_FIELDS)

/**
 * Build the OID content core of a CDRO: the object with EXACTLY the six
 * detached-signature / envelope fields removed at the top level, everything
 * else kept. Non-object inputs are returned unchanged so callers that pass a
 * pre-stripped body stay in control of what enters the hash.
 */
function cdroContentCore(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return value
  }
  const obj = value as Record<string, unknown>
  const core: Record<string, unknown> = {}
  for (const key of Object.keys(obj)) {
    if (!CDRO_ENVELOPE_FIELD_SET.has(key)) {
      core[key] = obj[key]
    }
  }
  return core
}

/**
 * Compute the OID of a GAP CDRO.
 *
 * Accepts either a pre-stripped payload or a full envelope. The six detached
 * envelope fields (CDRO_ENVELOPE_FIELDS) are stripped before canonicalization
 * so both forms produce the same OID and a post-attestation object yields the
 * SAME OID as its pre-attestation form.
 *
 * @param body - the OID payload or full CDRO envelope.
 * @returns the canonical OID string `"sha256:<hex>"`.
 */
export function computeGapOid(body: unknown): string {
  const canonical = canonicalize(cdroContentCore(body))
  const digest = sha256(new TextEncoder().encode(canonical))
  return 'sha256:' + bytesToHex(digest)
}
