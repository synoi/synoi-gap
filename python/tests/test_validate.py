"""Validation tests.

Run with: python tests/test_validate.py
"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from synoi_gap.validate import (
    validate_cdro_envelope,
    validate_capability_declaration,
    validate_capability_grant,
    validate_capability_invocation,
)


def _base_envelope(**overrides) -> dict:
    env = {
        "oid": "sha256:abc",
        "type": "gap:capability_declaration",
        "gap_version": "1.0",
        "tenant_id": "t",
        "created_at_ms": 1,
        "created_by": "actor:a",
        "body": {},
    }
    env.update(overrides)
    return env


def test_valid_envelope():
    assert validate_cdro_envelope(_base_envelope()) == []


def test_missing_oid():
    env = _base_envelope()
    del env["oid"]
    errors = validate_cdro_envelope(env)
    assert any("oid" in e for e in errors)


def test_missing_type():
    env = _base_envelope()
    del env["type"]
    errors = validate_cdro_envelope(env)
    assert any("type" in e for e in errors)


def test_missing_gap_version():
    env = _base_envelope()
    del env["gap_version"]
    errors = validate_cdro_envelope(env)
    assert any("gap_version" in e for e in errors)


def test_missing_tenant_id():
    env = _base_envelope()
    del env["tenant_id"]
    errors = validate_cdro_envelope(env)
    assert any("tenant_id" in e for e in errors)


def test_missing_created_at_ms():
    env = _base_envelope()
    del env["created_at_ms"]
    errors = validate_cdro_envelope(env)
    assert any("created_at_ms" in e for e in errors)


def test_missing_created_by():
    env = _base_envelope()
    del env["created_by"]
    errors = validate_cdro_envelope(env)
    assert any("created_by" in e for e in errors)


def test_missing_body():
    env = _base_envelope()
    del env["body"]
    errors = validate_cdro_envelope(env)
    assert any("body" in e for e in errors)


def test_wrong_gap_version():
    env = _base_envelope(gap_version="2.0")
    errors = validate_cdro_envelope(env)
    assert any("gap_version" in e for e in errors)


def test_oid_bad_prefix():
    env = _base_envelope(oid="md5:abc")
    errors = validate_cdro_envelope(env)
    assert any("sha256" in e for e in errors)


def test_unknown_type_is_flagged():
    env = _base_envelope(type="gap:unknown_type")
    errors = validate_cdro_envelope(env)
    assert any("unknown type" in e for e in errors)


def test_all_known_types_pass():
    known = [
        "gap:capability_declaration",
        "gap:capability_grant",
        "gap:capability_invocation",
        "gap:workflow_definition",
        "gap:workflow_instance",
        "gap:stage_transition",
        "gap:channel_event",
        "gap:decision_receipt",
        "gap:revocation_event",
        "gap:federation_handshake",
        "gap:break_glass_token",
        "gap:local_override_credential",
        "gap:lca_root",
        "gap:erasure_event",
        "gap:orchestration_chain",
        "gap:consent_record",
        "gap:pip_response",
    ]
    for t in known:
        env = _base_envelope(type=t)
        errors = validate_cdro_envelope(env)
        type_errors = [e for e in errors if "unknown type" in e]
        assert type_errors == [], f"type {t!r} should be valid, got: {type_errors}"


def _base_declaration() -> dict:
    return {
        "oid": "sha256:abc",
        "type": "gap:capability_declaration",
        "gap_version": "1.0",
        "tenant_id": "t",
        "created_at_ms": 1,
        "created_by": "actor:a",
        "body": {
            "actor_type": "service",
            "actor_id": "my-service",
            "actor_name": "My Service",
            "actor_version": "1.0.0",
            "capabilities": [],
        },
    }


def test_valid_declaration():
    assert validate_capability_declaration(_base_declaration()) == []


def test_declaration_wrong_type():
    decl = _base_declaration()
    decl["type"] = "gap:capability_grant"
    errors = validate_capability_declaration(decl)
    assert any("gap:capability_declaration" in e for e in errors)


def test_declaration_missing_actor_id():
    decl = _base_declaration()
    del decl["body"]["actor_id"]
    errors = validate_capability_declaration(decl)
    assert any("actor_id" in e for e in errors)


def test_declaration_capabilities_not_list():
    decl = _base_declaration()
    decl["body"]["capabilities"] = "not-a-list"
    errors = validate_capability_declaration(decl)
    assert any("capabilities" in e for e in errors)


def _base_grant() -> dict:
    return {
        "oid": "sha256:abc",
        "type": "gap:capability_grant",
        "gap_version": "1.0",
        "tenant_id": "t",
        "created_at_ms": 1,
        "created_by": "actor:a",
        "body": {
            "grantee": {"actor_type": "service", "actor_oid": "sha256:svc"},
            "capability_scopes": [{"capability": "skill.create"}],
            "granted_at_ms": 1,
            "granted_by": "actor:admin",
        },
    }


def test_valid_grant():
    assert validate_capability_grant(_base_grant()) == []


def test_grant_wrong_type():
    grant = _base_grant()
    grant["type"] = "gap:capability_declaration"
    errors = validate_capability_grant(grant)
    assert any("gap:capability_grant" in e for e in errors)


def test_grant_missing_grantee():
    grant = _base_grant()
    del grant["body"]["grantee"]
    errors = validate_capability_grant(grant)
    assert any("grantee" in e for e in errors)


def test_grant_scopes_not_list():
    grant = _base_grant()
    grant["body"]["capability_scopes"] = "not-a-list"
    errors = validate_capability_grant(grant)
    assert any("capability_scopes" in e for e in errors)


def _base_invocation() -> dict:
    return {
        "oid": "sha256:abc",
        "type": "gap:capability_invocation",
        "gap_version": "1.0",
        "tenant_id": "t",
        "created_at_ms": 1,
        "created_by": "actor:a",
        "body": {
            "caller": {
                "actor_type": "agent",
                "actor_oid": "sha256:agt",
                "grant_oid": "sha256:grant",
            },
            "capability": "skill.create",
            "args": {},
        },
    }


def test_valid_invocation():
    assert validate_capability_invocation(_base_invocation()) == []


def test_invocation_wrong_type():
    inv = _base_invocation()
    inv["type"] = "gap:capability_grant"
    errors = validate_capability_invocation(inv)
    assert any("gap:capability_invocation" in e for e in errors)


def test_invocation_missing_capability():
    inv = _base_invocation()
    del inv["body"]["capability"]
    errors = validate_capability_invocation(inv)
    assert any("capability" in e for e in errors)


def test_invocation_missing_args():
    inv = _base_invocation()
    del inv["body"]["args"]
    errors = validate_capability_invocation(inv)
    assert any("args" in e for e in errors)


if __name__ == "__main__":
    test_valid_envelope()
    test_missing_oid()
    test_missing_type()
    test_missing_gap_version()
    test_missing_tenant_id()
    test_missing_created_at_ms()
    test_missing_created_by()
    test_missing_body()
    test_wrong_gap_version()
    test_oid_bad_prefix()
    test_unknown_type_is_flagged()
    test_all_known_types_pass()
    test_valid_declaration()
    test_declaration_wrong_type()
    test_declaration_missing_actor_id()
    test_declaration_capabilities_not_list()
    test_valid_grant()
    test_grant_wrong_type()
    test_grant_missing_grantee()
    test_grant_scopes_not_list()
    test_valid_invocation()
    test_invocation_wrong_type()
    test_invocation_missing_capability()
    test_invocation_missing_args()
    print("All validation tests passed")
