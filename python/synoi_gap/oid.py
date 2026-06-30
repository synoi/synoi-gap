"""
OID computation for GAP CDROs.

Algorithm: sha256(canonicalize(payload)) where payload is the CDRO envelope
minus the fields excluded from the hash: oid, gap_version, signature,
signature_key_id, supersedes.

Canonical form rules (must produce byte-identical output to the TypeScript
reference in src/canonicalize.ts and synoi-sraid/src/canonicalize.ts, RFC 8785 JCS):
- Object keys sorted lexicographically at every nesting level.
- Object keys whose value is absent are omitted (Python: key not in dict).
- Object keys with value None are KEPT and serialized as JSON null.
  (Python None = JSON null = a first-class JSON value per RFC 8785; only the
  JavaScript concept of `undefined` -- which has no Python equivalent -- is dropped.)
- Arrays preserve element order; None elements are serialized as null.
- Scalars (str, int, bool, None) round-trip through json.dumps(ensure_ascii=False).
  GAP 1.0 forbids float values; use integer minor units (e.g. cents) for money.
- Non-ASCII characters MUST be emitted as UTF-8 byte sequences, NOT as Unicode escapes.
  (json.dumps default uses ensure_ascii=True which produces \\uXXXX sequences; this
  implementation explicitly passes ensure_ascii=False to match JavaScript JSON.stringify.)
- No extra whitespace.
- Output encoded as UTF-8 before hashing.
"""
import hashlib
import json
import math
from typing import Any

_EXCLUDED = frozenset({"oid", "gap_version", "signature", "signature_key_id", "supersedes"})


def _canonical_value(obj: Any) -> str:
    """Return the canonical JSON string for a single value.

    Mirrors canonicalize.ts:
      - null / non-object scalars -> JSON.stringify (json.dumps equivalent)
      - arrays -> recurse, preserving None as null
      - dicts -> sort keys, keep None-valued keys (None = JSON null), recurse values
    """
    if obj is None:
        # None as a standalone value serializes as JSON null (matches TS: JSON.stringify(null) == "null").
        return "null"
    if isinstance(obj, bool):
        # bool must come before int check because bool is a subclass of int.
        return "true" if obj else "false"
    if isinstance(obj, float):
        # GAP 1.0 forbids float values. Money fields must use integer minor units (e.g. cents).
        # Check for special float values first so the error message is specific.
        if math.isnan(obj):
            raise TypeError("GAP canonicalize: float values are not allowed; use integer minor units (e.g. cents). Got: nan")
        if math.isinf(obj):
            raise TypeError("GAP canonicalize: float values are not allowed; use integer minor units (e.g. cents). Got: inf")
        raise TypeError("GAP canonicalize: float values are not allowed; use integer minor units (e.g. cents)")
    if isinstance(obj, int):
        return json.dumps(obj)
    if isinstance(obj, str):
        # ensure_ascii=False: emit non-ASCII as UTF-8, not \uXXXX escapes.
        # This matches JavaScript JSON.stringify which never escapes codepoints > U+007F.
        return json.dumps(obj, ensure_ascii=False)
    if isinstance(obj, list):
        # Arrays: preserve order, None elements become null (TS: JSON.stringify(null) == "null").
        return "[" + ",".join(_canonical_value(v) for v in obj) + "]"
    if isinstance(obj, dict):
        # Keep ALL present keys, including None-valued ones (None = JSON null per RFC 8785).
        # Python has no `undefined`; only absent keys are omitted, never None-valued ones.
        pairs = sorted(obj.items())
        return "{" + ",".join(
            # ensure_ascii=False on keys too: dict keys may contain non-ASCII characters.
            json.dumps(k, ensure_ascii=False) + ":" + _canonical_value(v) for k, v in pairs
        ) + "}"
    # Fallback for any other type: let json.dumps handle it (will raise for non-serializable types).
    return json.dumps(obj, ensure_ascii=False)


def canonicalize(obj: Any) -> str:
    """Return the canonical JSON string for obj.

    This is the public entry point. It produces output byte-identical to the
    TypeScript canonicalize() in src/canonicalize.ts for any GAP-legal input.
    """
    return _canonical_value(obj)


def compute_gap_oid(envelope: dict) -> str:
    """Compute the content-addressed OID for a GAP CDRO envelope.

    Strips the excluded fields before hashing. Returns "sha256:<hex>".

    The excluded fields are: oid, gap_version, signature, signature_key_id,
    supersedes. Removing them before hashing is the rule defined in cdro.ts
    and Section 2.2 of IMPLEMENTING.md.
    """
    payload = {k: v for k, v in envelope.items() if k not in _EXCLUDED}
    canonical = canonicalize(payload)
    digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    return f"sha256:{digest}"
