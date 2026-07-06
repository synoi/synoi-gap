/**
 * canonicalize.ts -- deterministic RFC 8785 (JCS) serializer for GAP OID
 * computation and signing.
 *
 * This is DERIVED from the single normative source, synoi-sraid/PROJECTION_SPEC.md
 * (ADR_019 decisions 2-3), and is byte-for-byte identical to the reference
 * implementation @synoi/sraid src/canonicalize.ts. It is NOT an independent
 * second canonicalizer; a divergence is non-conformant and is caught by the
 * shared conformance vectors.
 *
 * Rules (strict RFC 8785 JCS, ADR_019 narrowing):
 *   - Numbers must be FINITE INTEGERS. NaN, Infinity, and any non-integer
 *     (float) are REJECTED with a thrown TypeError BEFORE hashing. GAP CDROs
 *     use integer minor units (e.g. cents) for money and integer milliseconds
 *     for time; no conformant object legitimately carries a float.
 *   - Object keys are sorted in ascending UTF-16 code-unit order
 *     (Array.prototype.sort default), per RFC 8785 §3.2.3 for UTF-16 hosts.
 *   - Object properties whose value is `undefined` are OMITTED (JSON data
 *     model). An `undefined` ARRAY element throws (omitting would shift
 *     indices and silently change meaning).
 *   - Strings use minimal JSON escaping; non-ASCII is emitted as literal UTF-8.
 *   - `null` is preserved as `null`; booleans as `true` / `false`.
 *   - No whitespace anywhere; separators are bare `,` and `:`.
 *
 * Reject-loud contract: a TypeError is thrown for any value that is not a JSON
 * value, rather than silently producing a wrong or invalid canonical form
 * (which would corrupt an OID or signature): non-integer / non-finite numbers,
 * undefined / function / symbol / bigint anywhere, a sparse array hole, and any
 * object exposing a toJSON() method (e.g. Date -- serialize it first).
 *
 * Stability invariant: any change breaks every OID and every signature; it is a
 * cross-package, cross-language contract and MUST NOT change without a
 * coordinated migration.
 */
export function canonicalize(value: unknown): string {
  const t = typeof value

  if (t === 'number') {
    if (!isFinite(value as number)) {
      throw new TypeError(
        `GAP canonicalize: RFC 8785 forbids non-finite numbers; received ${String(value)}`,
      )
    }
    if (!Number.isInteger(value as number)) {
      throw new TypeError(
        `GAP canonicalize: non-integer numbers are forbidden (ADR_019); received ${String(value)}. ` +
          'Represent fractional quantities as integer minor units (e.g. cents) before canonicalizing.',
      )
    }
    return JSON.stringify(value)
  }

  if (value === null) return 'null'
  if (t === 'string' || t === 'boolean') return JSON.stringify(value as string | boolean)

  if (t === 'undefined' || t === 'function' || t === 'symbol' || t === 'bigint') {
    throw new TypeError(
      `GAP canonicalize: value of type "${t}" is not a JSON value and cannot be canonicalized`,
    )
  }

  // value is a non-null object from here.
  if (Array.isArray(value)) {
    const parts: string[] = []
    for (let i = 0; i < value.length; i++) {
      if (!(i in value)) {
        throw new TypeError(
          `GAP canonicalize: sparse array hole at index ${i} is not a JSON value and cannot be ` +
            'canonicalized (it would produce invalid JSON like "[1,,2]"); fill the slot with an ' +
            'explicit value (e.g. null) before canonicalizing',
        )
      }
      parts.push(canonicalize(value[i]))
    }
    return '[' + parts.join(',') + ']'
  }

  if (typeof (value as { toJSON?: unknown }).toJSON === 'function') {
    throw new TypeError(
      'GAP canonicalize: objects with a toJSON() method (e.g. Date) are not accepted; ' +
        'serialize them to a JSON value (e.g. an ISO string) before canonicalizing',
    )
  }

  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalize(obj[k])).join(',') + '}'
}
