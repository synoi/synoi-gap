/**
 * oid.ts -- OID computation for GAP CDROs.
 *
 * The CDRO OID content-core projection is IMPORTED from @synoi/sraid, not
 * reimplemented here.
 *
 * It used to be reimplemented, derived faithfully from
 * synoi-sraid/PROJECTION_SPEC.md, with the correct six-name strip set, on the
 * stated assumption that "a byte-for-byte divergence from the reference
 * implementation is caught by the shared conformance vectors". That assumption
 * was false in both halves. The copy diverged - it carried the same __proto__
 * OID collision as the reference, because the prose "remove exactly these six
 * fields, keep everything else" translates in JavaScript into `core[k] = v`,
 * which silently drops an own __proto__ - and no conformance vector covered
 * that shape, so nothing caught it. Two teams reading correct prose wrote the
 * same defect.
 *
 * The original reason for the copy was real: sraid's default entry imports
 * node:crypto and this package must stay portable. The projection never needed
 * crypto - only the hashing did - so it now comes from the PURE
 * @synoi/sraid/content-core subpath while the hash stays @noble here. Identical
 * by construction rather than by agreement.
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
// THE normative projection, imported rather than reimplemented. Pure subpath:
// no node:crypto in its graph, so this package stays portable and keeps its
// own @noble hash. See the header note above.
import { cdroContentCore } from '@synoi/sraid/content-core'

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
