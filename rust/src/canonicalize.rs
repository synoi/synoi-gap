//! RFC 8785 (JCS) canonical JSON serializer.
//!
//! This is the byte-for-byte counterpart of the TypeScript reference
//! canonicalizer in `@synoi/sraid` (`src/canonicalize.ts`) and the
//! `@synoi/gap` GAP canonicalizer. The output string is the normative input
//! to SHA-256 for OID derivation and to Ed25519 / ML-DSA-65 for signing.
//!
//! The rules that make the output cross-language stable, and where a naive
//! Rust port would silently diverge:
//!
//!   1. Object keys are sorted by **UTF-16 code unit** value, NOT by Unicode
//!      scalar (`char`) value and NOT by UTF-8 bytes. RFC 8785 §3.2.3 pins
//!      this to UTF-16 because the reference implementation is ECMAScript,
//!      whose `String.prototype.sort` compares UTF-16 code units. For BMP
//!      characters UTF-16 order equals scalar order, but an astral character
//!      such as an emoji (U+1F600) encodes as a surrogate pair whose leading
//!      unit (0xD83D) sorts it AFTER `é` (U+00E9) even though its scalar value
//!      is far larger. Rust's default `str` ordering would place the emoji
//!      first and fork the OID. We therefore sort on the UTF-16 encoding.
//!      (Conformance: `sraid/canonicalize-edge.json` "unicode key ordering" and
//!      "emoji key sorts after ASCII".)
//!
//!   2. Numbers are emitted with the ECMAScript Number-to-string algorithm
//!      (RFC 8785 §3.2.2.3). We preserve the exact numeric token from the
//!      parsed JSON via serde_json's `arbitrary_precision`, which is identical
//!      to the ECMAScript shortest round-trip form for every value expressible
//!      in a JSON document (e.g. `3.14`, `1e-10`, `9007199254740991`, `-42`,
//!      `0`). Non-finite numbers cannot appear in a parsed JSON document, and
//!      the reject path is covered by `canonicalize_reject` at the parse layer.
//!
//!   3. Arrays preserve order; scalars use standard JSON escaping; `null` is
//!      a first-class value and is preserved.
//!
//! Stability invariant: any change to this function changes every OID and
//! invalidates every signature. It must never change without a coordinated
//! cross-language migration.

use serde_json::Value;

/// Canonicalize a parsed JSON value into its RFC 8785 (JCS) string form.
///
/// This is the permissive SRAID profile: it accepts any parsed JSON number,
/// including non-integers, matching the `sraid/canonicalize.json` /
/// `sraid/canonicalize-edge.json` vectors. For the GAP CDRO OID / signing path,
/// which forbids floats (ADR_019 decision 2), use [`canonicalize_gap`].
pub fn canonicalize(value: &Value) -> String {
    let mut out = String::new();
    write_value(value, &mut out);
    out
}

/// Canonicalize with the GAP CDRO number rule (ADR_019 decision 2;
/// synoi-sraid/PROJECTION_SPEC.md §3.1): a number is legal iff it is a finite
/// integer. Any non-integer number is REJECTED with a typed error BEFORE
/// hashing. GAP CDROs use integer minor units for money and integer
/// milliseconds for time; no conformant object carries a float. This is the
/// serializer the OID and signing paths use, so a float-bearing object cannot
/// mint an OID that another surface declares malformed.
pub fn canonicalize_gap(value: &Value) -> Result<String, String> {
    reject_non_integer(value)?;
    Ok(canonicalize(value))
}

/// Walk the value tree and reject any non-integer number (ADR_019 §3.1). With
/// serde_json's `arbitrary_precision`, `Number::is_i64() || is_u64()` is true
/// exactly for integer tokens; a fractional or exponent-form non-integer is
/// neither, so it is rejected here.
fn reject_non_integer(value: &Value) -> Result<(), String> {
    match value {
        Value::Number(n) => {
            if n.is_i64() || n.is_u64() {
                Ok(())
            } else {
                Err(format!(
                    "gap canonicalize: non-integer numbers are forbidden (ADR_019); received {n}. \
                     Represent fractional quantities as integer minor units (e.g. cents)."
                ))
            }
        }
        Value::Array(arr) => {
            for el in arr {
                reject_non_integer(el)?;
            }
            Ok(())
        }
        Value::Object(map) => {
            for v in map.values() {
                reject_non_integer(v)?;
            }
            Ok(())
        }
        _ => Ok(()),
    }
}

fn write_value(value: &Value, out: &mut String) {
    match value {
        Value::Null => out.push_str("null"),
        Value::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Value::Number(n) => write_number(n, out),
        Value::String(s) => write_json_string(s, out),
        Value::Array(arr) => {
            out.push('[');
            for (i, el) in arr.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_value(el, out);
            }
            out.push(']');
        }
        Value::Object(map) => {
            // Sort keys by UTF-16 code unit order (see rule 1 above).
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort_by(|a, b| cmp_utf16(a, b));
            out.push('{');
            for (i, k) in keys.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_json_string(k, out);
                out.push(':');
                write_value(map.get(*k).unwrap(), out);
            }
            out.push('}');
        }
    }
}

/// Emit the numeric token. With `arbitrary_precision` enabled, `Number`'s
/// `Display` reproduces the exact token text the JSON parser saw, which is the
/// ECMAScript shortest-round-trip form for any JSON-expressible number.
fn write_number(n: &serde_json::Number, out: &mut String) {
    out.push_str(&n.to_string());
}

/// Compare two strings by their UTF-16 code unit sequences.
///
/// This is what ECMAScript `Array.prototype.sort` does on JS strings, and is
/// what RFC 8785 §3.2.3 requires. We compare the `encode_utf16()` iterators
/// lexicographically without allocating a full UTF-16 buffer.
fn cmp_utf16(a: &str, b: &str) -> std::cmp::Ordering {
    a.encode_utf16().cmp(b.encode_utf16())
}

/// Standard JSON string escaping, matching `JSON.stringify` for a lone string.
///
/// RFC 8785 §3.2.2.2 pins escaping to the JSON grammar: `"`, `\`, and the C0
/// control characters (U+0000..U+001F) are escaped; the short forms
/// (`\b \t \n \f \r`) are used where defined, everything else in the control
/// range uses `\u00XX`. All other characters (including non-ASCII such as `é`,
/// `☃`, and emoji) are emitted literally as UTF-8. This mirrors
/// `JSON.stringify`, which does NOT escape non-ASCII.
fn write_json_string(s: &str, out: &mut String) {
    out.push('"');
    for ch in s.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{0008}' => out.push_str("\\b"),
            '\u{0009}' => out.push_str("\\t"),
            '\u{000A}' => out.push_str("\\n"),
            '\u{000C}' => out.push_str("\\f"),
            '\u{000D}' => out.push_str("\\r"),
            c if (c as u32) < 0x20 => {
                out.push_str(&format!("\\u{:04x}", c as u32));
            }
            c => out.push(c),
        }
    }
    out.push('"');
}
