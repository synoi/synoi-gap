/**
 * oid.ts -- OID computation for GAP CDROs.
 *
 * Implements RFC 8785 JCS canonical JSON. See IMPLEMENTING.md §2.2 for the
 * normative rules.
 *
 *     sha256(canonicalize(envelope_minus_excluded_fields))
 *
 * Excluded fields (stripped before hashing): oid, gap_version, signature,
 * signature_key_id, supersedes. Signatures are added after OID computation.
 *
 * The shape passed in is the OID payload: `{ type, tenant_id, created_at_ms,
 * created_by, body }`. The full envelope (with oid + gap_version) is built
 * around it.
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
 * Fields excluded from the OID hash. These are present in the full envelope
 * but MUST NOT contribute to the content hash. Strip them before hashing so
 * that TypeScript and Python produce byte-identical OIDs regardless of whether
 * the caller passes a pre-stripped payload or a full envelope.
 */
const EXCLUDED_FIELDS = new Set([
  'oid',
  'gap_version',
  'signature',
  'signature_key_id',
  'supersedes',
])

/**
 * Compute the OID of a GAP CDRO payload.
 *
 * Accepts either a pre-stripped payload or a full envelope (with oid,
 * gap_version, signature, signature_key_id, supersedes present). The 5
 * excluded fields are stripped before canonicalization so both forms produce
 * the same OID.
 *
 * @param body - the OID payload or full envelope (see CDRO §2.1 in GAP_SPEC).
 * @returns the canonical OID string `"sha256:<hex>"`.
 */
export function computeGapOid(body: unknown): string {
  let stripped: unknown = body
  if (body !== null && typeof body === 'object' && !Array.isArray(body)) {
    const obj = body as Record<string, unknown>
    const result: Record<string, unknown> = {}
    for (const key of Object.keys(obj)) {
      if (!EXCLUDED_FIELDS.has(key)) {
        result[key] = obj[key]
      }
    }
    stripped = result
  }
  const canonical = canonicalize(stripped)
  const digest = sha256(new TextEncoder().encode(canonical))
  return 'sha256:' + bytesToHex(digest)
}
