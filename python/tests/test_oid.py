"""OID computation tests.

These vectors must produce byte-identical output to the TypeScript
implementation in src/canonicalize.ts and src/oid.ts.

Run with: python tests/test_oid.py
"""
import sys
import os
import hashlib
import json

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from synoi_gap.oid import canonicalize, compute_gap_oid
from synoi_gap.validate import validate_cdro_envelope


def test_canonical_key_sort():
    assert canonicalize({"b": 1, "a": 2}) == '{"a":2,"b":1}'


def test_canonical_none_kept_as_null_in_dict():
    assert canonicalize({"a": 1, "b": None}) == '{"a":1,"b":null}'


def test_canonical_nested():
    assert canonicalize({"z": {"b": 2, "a": 1}}) == '{"z":{"a":1,"b":2}}'


def test_canonical_array_preserves_order():
    assert canonicalize([3, 1, 2]) == "[3,1,2]"


def test_canonical_bool_true():
    assert canonicalize(True) == "true"


def test_canonical_bool_false():
    assert canonicalize(False) == "false"


def test_canonical_string():
    assert canonicalize("hello") == '"hello"'


def test_canonical_string_escaping():
    assert canonicalize('say "hi"') == '"say \\"hi\\""'


def test_canonical_int():
    assert canonicalize(42) == "42"


def test_canonical_negative_int_passes():
    assert canonicalize(-1) == "-1"


def test_canonical_float_raises():
    raised = False
    try:
        canonicalize(1.5)
    except TypeError:
        raised = True
    assert raised, "Expected TypeError for float input"


def test_canonical_float_inf_raises():
    import math
    raised = False
    try:
        canonicalize(math.inf)
    except TypeError:
        raised = True
    assert raised, "Expected TypeError for float inf input"


def test_canonical_float_nan_raises():
    import math
    raised = False
    try:
        canonicalize(math.nan)
    except TypeError:
        raised = True
    assert raised, "Expected TypeError for float nan input"


def test_canonical_null_standalone():
    assert canonicalize(None) == "null"


def test_canonical_null_in_array():
    assert canonicalize([1, None, 3]) == "[1,null,3]"


def test_canonical_non_ascii_utf8_not_escaped():
    """Cross-language golden rule: non-ASCII characters MUST be emitted as
    UTF-8 byte sequences, not as \\uXXXX escape sequences.

    Python json.dumps default uses ensure_ascii=True which produces Unicode escape
    sequences; this implementation uses ensure_ascii=False to match JSON.stringify.
    Both SDKs must produce identical bytes for the same payload containing
    non-ASCII strings, or OIDs will diverge on any body with emoji or accented text.
    """
    # Café emoji golden vector (matches TypeScript canonicalize output)
    result = canonicalize({"emoji": "🚀", "s": "é"})
    assert result == '{"emoji":"🚀","s":"é"}', (
        f"Expected UTF-8 literal output, got: {result!r}. "
        "If you see \\uXXXX escapes, ensure_ascii=False is not being applied."
    )


def test_canonical_non_ascii_in_key():
    """Non-ASCII characters in object KEYS must also be emitted as UTF-8."""
    result = canonicalize({"café": 1})
    assert result == '{"café":1}'


def test_canonical_deep_nested():
    obj = {"outer": {"z": [1, 2], "a": {"y": False, "x": True}}}
    result = canonicalize(obj)
    assert result == '{"outer":{"a":{"x":true,"y":false},"z":[1,2]}}'


def test_canonical_matches_spec_example():
    payload = {
        "type": "gap:capability_declaration",
        "created_by": "sha256:abc",
        "tenant_id": "t1",
        "created_at_ms": 1,
        "body": {"z": 1, "a": 2},
    }
    expected = (
        '{"body":{"a":2,"z":1},"created_at_ms":1,"created_by":"sha256:abc",'
        '"tenant_id":"t1","type":"gap:capability_declaration"}'
    )
    assert canonicalize(payload) == expected


def test_oid_excludes_reserved_fields():
    envelope = {
        "oid": "sha256:old",
        "type": "gap:capability_declaration",
        "gap_version": "1.0",
        "tenant_id": "test",
        "created_at_ms": 1000,
        "created_by": "actor:test",
        "body": {"actor_type": "service"},
        "signature": "abc",
        "signature_key_id": "key1",
        "supersedes": "sha256:prior",
    }
    oid = compute_gap_oid(envelope)
    assert oid.startswith("sha256:")
    minimal = {k: envelope[k] for k in ("type", "tenant_id", "created_at_ms", "created_by", "body")}
    assert compute_gap_oid(minimal) == oid


def test_oid_is_deterministic():
    envelope = {
        "type": "gap:capability_grant",
        "tenant_id": "t",
        "created_at_ms": 1,
        "created_by": "a",
        "body": {},
    }
    assert compute_gap_oid(envelope) == compute_gap_oid(envelope)


def test_oid_field_order_invariant():
    e1 = {"type": "gap:capability_grant", "tenant_id": "t", "created_at_ms": 1, "created_by": "a", "body": {}}
    e2 = {"created_by": "a", "body": {}, "type": "gap:capability_grant", "tenant_id": "t", "created_at_ms": 1}
    assert compute_gap_oid(e1) == compute_gap_oid(e2)


def test_oid_format():
    envelope = {
        "type": "gap:capability_grant",
        "tenant_id": "t",
        "created_at_ms": 1,
        "created_by": "a",
        "body": {},
    }
    oid = compute_gap_oid(envelope)
    prefix, hex_part = oid.split(":", 1)
    assert prefix == "sha256"
    assert len(hex_part) == 64
    assert all(c in "0123456789abcdef" for c in hex_part)


def test_oid_known_vector():
    payload = {
        "type": "gap:capability_declaration",
        "created_by": "sha256:abc",
        "tenant_id": "t1",
        "created_at_ms": 1,
        "body": {"z": 1, "a": 2},
    }
    canonical = (
        '{"body":{"a":2,"z":1},"created_at_ms":1,"created_by":"sha256:abc",'
        '"tenant_id":"t1","type":"gap:capability_declaration"}'
    )
    expected_hex = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    expected_oid = f"sha256:{expected_hex}"
    assert compute_gap_oid(payload) == expected_oid


def test_oid_body_content_changes_oid():
    base = {"type": "gap:capability_grant", "tenant_id": "t", "created_at_ms": 1, "created_by": "a", "body": {}}
    modified = dict(base, body={"extra": "field"})
    assert compute_gap_oid(base) != compute_gap_oid(modified)


def test_canonical_null_differs_from_absent_in_object():
    """Cross-language golden rule (RFC 8785 JCS): None in a dict is KEPT as JSON null.

    A present-None key is different from an absent key. This matches SRAID and
    the TypeScript canonicalize.ts (only undefined/absent keys are dropped, not null).
    Any payload with a None-valued field MUST produce a DIFFERENT canonical form
    from the same payload with that key absent.
    """
    assert canonicalize({"a": 1, "b": None, "c": 3}) == '{"a":1,"b":null,"c":3}'
    assert canonicalize({"a": 1, "b": None, "c": 3}) != canonicalize({"a": 1, "c": 3})


def test_oid_null_field_differs_from_absent_field():
    """OID differs when a field is explicitly None vs simply absent (regression guard).

    This is the cross-language parity test: the TypeScript SDK and this Python SDK
    MUST both produce a DIFFERENT hash when an optional field is explicitly None
    vs missing from the dict. If these collide, null is being silently dropped,
    which diverges from SRAID/gateway and breaks signature verification.
    """
    base = {
        "type": "gap:capability_grant",
        "tenant_id": "xtest",
        "created_at_ms": 1,
        "created_by": "actor:a",
        "body": {"a": 1},
    }
    with_null = {
        "type": "gap:capability_grant",
        "tenant_id": "xtest",
        "created_at_ms": 1,
        "created_by": "actor:a",
        "body": {"a": 1, "expires_at_ms": None},
    }
    assert compute_gap_oid(with_null) != compute_gap_oid(base)


def test_oid_cross_language_v_decl_pinned():
    """Cross-language parity: must match TypeScript V_DECL OID from CONFORMANCE_VECTORS.json."""
    payload = {
        "type": "gap:capability_declaration",
        "tenant_id": "tenant-vector-1",
        "created_at_ms": 1700000000000,
        "created_by": "actor:operator",
        "body": {
            "actor_type": "skill",
            "actor_id": "skill:demo",
            "actor_name": "Demo",
            "actor_version": "1.0.0",
            "capabilities": [{"capability": "demo.say_hello"}],
        },
    }
    assert compute_gap_oid(payload) == "sha256:8ba63136f70092f3bb4b35d8194c43255077f6332dad40e4bcdab4a1220b0612"


def test_oid_cross_language_v_grant_pinned():
    """Cross-language parity: must match TypeScript V_GRANT OID from CONFORMANCE_VECTORS.json."""
    payload = {
        "type": "gap:capability_grant",
        "tenant_id": "tenant-vector-2",
        "created_at_ms": 1700000001000,
        "created_by": "actor:operator",
        "body": {
            "grantee": {"actor_type": "skill", "actor_oid": "actor:abc"},
            "capability_scopes": [{"capability": "demo.*"}],
            "granted_at_ms": 1700000001000,
            "expires_at_ms": None,
            "granted_by": "actor:operator",
        },
    }
    assert compute_gap_oid(payload) == "sha256:b6c8902926d49cf6a88c1393e6f038825f3fed0a79b13d60335c6729883dbc75"


def test_oid_cross_language_v_non_ascii_pinned():
    """Cross-language parity: non-ASCII vector from CONFORMANCE_VECTORS.json.

    Python must emit UTF-8 literals (ensure_ascii=False), not \\uXXXX escapes.
    If this test fails the canonical string diverges from TypeScript and all
    OIDs for payloads with emoji or accented text will be wrong.
    """
    payload = {
        "type": "gap:capability_declaration",
        "tenant_id": "t1",
        "created_at_ms": 1,
        "created_by": "actor:test",
        "body": {"emoji": "🚀", "s": "é"},
    }
    assert compute_gap_oid(payload) == "sha256:fa1ef08af1e93fa09513bc31ef7ae72ee7ed8f5d7ce2d071d489b857023b910c"


def test_validate_rejects_float_created_at_ms():
    """validate_cdro_envelope must reject float created_at_ms (matches canonicalize float guard)."""
    envelope = {
        "oid": "sha256:" + "a" * 64,
        "type": "gap:capability_grant",
        "gap_version": "1.0",
        "tenant_id": "t",
        "created_at_ms": 1.5,
        "created_by": "actor:a",
        "body": {},
    }
    errors = validate_cdro_envelope(envelope)
    assert any("integer" in e for e in errors), (
        f"Expected integer error for float created_at_ms, got: {errors}"
    )


def test_validate_accepts_integer_created_at_ms():
    """validate_cdro_envelope must accept integer created_at_ms."""
    envelope = {
        "oid": "sha256:" + "a" * 64,
        "type": "gap:capability_grant",
        "gap_version": "1.0",
        "tenant_id": "t",
        "created_at_ms": 1700000000000,
        "created_by": "actor:a",
        "body": {},
    }
    errors = validate_cdro_envelope(envelope)
    assert not any("created_at_ms" in e for e in errors), (
        f"Unexpected created_at_ms error for valid integer: {errors}"
    )


if __name__ == "__main__":
    test_canonical_key_sort()
    test_canonical_none_kept_as_null_in_dict()
    test_canonical_nested()
    test_canonical_array_preserves_order()
    test_canonical_bool_true()
    test_canonical_bool_false()
    test_canonical_string()
    test_canonical_string_escaping()
    test_canonical_int()
    test_canonical_null_standalone()
    test_canonical_null_in_array()
    test_canonical_deep_nested()
    test_canonical_matches_spec_example()
    test_oid_excludes_reserved_fields()
    test_oid_is_deterministic()
    test_oid_field_order_invariant()
    test_oid_format()
    test_oid_known_vector()
    test_oid_body_content_changes_oid()
    test_canonical_null_differs_from_absent_in_object()
    test_oid_null_field_differs_from_absent_field()
    test_canonical_negative_int_passes()
    test_canonical_float_raises()
    test_canonical_float_inf_raises()
    test_canonical_float_nan_raises()
    test_oid_cross_language_v_decl_pinned()
    test_oid_cross_language_v_grant_pinned()
    test_oid_cross_language_v_non_ascii_pinned()
    test_validate_rejects_float_created_at_ms()
    test_validate_accepts_integer_created_at_ms()
    print("All OID tests passed")
