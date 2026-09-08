/**
 * canonicalize.ts -- RFC 8785 (JCS) canonical JSON, RE-EXPORTED from
 * @synoi/sraid, not reimplemented here.
 *
 * This module used to carry its own copy. The copy agreed with the reference
 * byte-for-byte on ordinary values (verified across primitives, nesting,
 * arrays, unicode, escapes, -0 and 1e21) but diverged on exactly one input:
 * an own `__proto__` member. The reference REJECTS it; the copy hashed it.
 * Combined with a separately reimplemented content-core projection that
 * DROPPED it, that mismatch produced an OID collision in this package - two
 * objects with different content sharing one OID - independently of the
 * identical collision in the reference implementation.
 *
 * Two teams reading the same correct prose wrote the same defect. The response
 * is to stop having two implementations of a contract that must be identical.
 * The reference canonicalizer is a PURE subpath with no node:crypto in its
 * graph, so importing it costs this package nothing in portability.
 *
 * The public `canonicalize` export is unchanged in name and signature. Its one
 * behavioural change is that an own `__proto__` member now throws instead of
 * being serialised - which is the fix, and is normative per
 * synoi-sraid/PROJECTION_SPEC.md section 2.
 */

export { canonicalize } from '@synoi/sraid/canonicalize'
