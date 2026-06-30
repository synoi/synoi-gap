/**
 * canonicalize.ts -- deterministic JSON serializer used by GAP OID computation.
 *
 * Implements RFC 8785 JCS canonical JSON. See IMPLEMENTING.md §2.2 for the
 * normative rules. Rules:
 *
 *   1. Keys are sorted lexicographically at every object level.
 *   2. Keys whose value is `undefined` are dropped entirely; `null` is kept
 *      and serialized as JSON null (RFC 8785 JCS: null is a first-class JSON value).
 *   3. Arrays preserve order.
 *   4. Scalars (string, number, boolean, null) serialize via JSON.stringify.
 *   5. Float values (non-integer numbers) are forbidden. GAP CDROs use integer
 *      minor units (e.g. cents) for all money and millisecond integers for time.
 *      Passing a float throws a TypeError. Infinity and NaN also throw.
 *
 * The output is a string suitable for hashing.
 */

export function canonicalize(value: unknown): string {
  if (typeof value === 'number') {
    if (!isFinite(value)) {
      throw new TypeError(
        `GAP canonicalize: non-finite number (${value}) is not allowed in canonical JSON`
      )
    }
    if (!Number.isInteger(value)) {
      throw new TypeError(
        'GAP canonicalize: float values are not allowed; use integer minor units (e.g. cents)'
      )
    }
    return JSON.stringify(value)
  }
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']'
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort()
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalize(obj[k])).join(',') + '}'
}
