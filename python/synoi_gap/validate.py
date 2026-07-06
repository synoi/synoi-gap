"""Basic shape validators for GAP CDROs.

These are not exhaustive -- they cover the fields an implementor most commonly
gets wrong. Pass through the errors list and fix each one before submitting
objects to a GAP gateway.

Numeric fields: all GAP-hashed numeric fields MUST be integers. Floats are not
permitted (see IMPLEMENTING.md §2.2). The canonicalize function rejects floats
at hash time; these validators enforce the same constraint at the validation
layer.
"""
from typing import Any

_REQUIRED_ENVELOPE = ("oid", "type", "gap_version", "tenant_id", "created_at_ms", "created_by", "body")

_VALID_TYPES = frozenset({
    "gap:capability_declaration",
    "gap:capability_grant",
    "gap:capability_invocation",
    "gap:workflow_definition",
    "gap:workflow_instance",
    "gap:stage_transition",
    "gap:channel_event",
    "gap:decision_receipt",
    "gap:revocation_event",
    "gap:federation_handshake",  # reserved for GAP 1.1 - accepted but not required
    "gap:break_glass_token",
    "gap:local_override_credential",
    "gap:lca_root",
    "gap:erasure_event",
    "gap:orchestration_chain",
    "gap:consent_record",
    "gap:pip_response",
})


def validate_cdro_envelope(obj: dict) -> list[str]:
    """Return a list of error strings. An empty list means the envelope is valid.

    Checks: required fields present, gap_version value, oid prefix format,
    type is a known gap: string.
    """
    errors: list[str] = []

    if not isinstance(obj, dict):
        return ["expected a dict"]

    for field in _REQUIRED_ENVELOPE:
        if field not in obj:
            errors.append(f"missing required field: {field}")

    gap_version = obj.get("gap_version")
    if gap_version is not None and gap_version != "1.0":
        errors.append(f"gap_version must be '1.0', got {gap_version!r}")

    oid = obj.get("oid")
    if oid is not None and not isinstance(oid, str):
        errors.append("oid must be a string")
    elif oid is not None and not oid.startswith("sha256:"):
        errors.append("oid must start with 'sha256:'")

    obj_type = obj.get("type")
    if obj_type is not None and obj_type not in _VALID_TYPES:
        errors.append(f"unknown type: {obj_type!r}")

    created_at = obj.get("created_at_ms")
    if created_at is not None and not (isinstance(created_at, int) and not isinstance(created_at, bool)):
        errors.append("created_at_ms must be a non-negative integer")

    return errors


def validate_capability_declaration(decl: dict) -> list[str]:
    """Validate a gap:capability_declaration envelope.

    Runs the general envelope check then verifies the declaration-specific body
    fields: actor_type, actor_id, actor_name, actor_version, capabilities.
    """
    errors = validate_cdro_envelope(decl)

    decl_type = decl.get("type")
    if decl_type is not None and decl_type != "gap:capability_declaration":
        errors.append(f"type must be 'gap:capability_declaration', got {decl_type!r}")

    body = decl.get("body")
    if not isinstance(body, dict):
        errors.append("body must be a dict")
    else:
        for field in ("actor_type", "actor_id", "actor_name", "actor_version", "capabilities"):
            if field not in body:
                errors.append(f"body missing required field: {field}")

        capabilities = body.get("capabilities")
        if capabilities is not None and not isinstance(capabilities, list):
            errors.append("body.capabilities must be a list")

    return errors


def validate_capability_grant(grant: dict) -> list[str]:
    """Validate a gap:capability_grant envelope.

    Runs the general envelope check then verifies the grant-specific body
    fields: grantee, capability_scopes, granted_at_ms, granted_by.
    """
    errors = validate_cdro_envelope(grant)

    grant_type = grant.get("type")
    if grant_type is not None and grant_type != "gap:capability_grant":
        errors.append(f"type must be 'gap:capability_grant', got {grant_type!r}")

    body = grant.get("body")
    if not isinstance(body, dict):
        errors.append("body must be a dict")
    else:
        for field in ("grantee", "capability_scopes", "granted_at_ms", "granted_by"):
            if field not in body:
                errors.append(f"body missing required field: {field}")

        scopes = body.get("capability_scopes")
        if scopes is not None and not isinstance(scopes, list):
            errors.append("body.capability_scopes must be a list")

        grantee = body.get("grantee")
        if grantee is not None and not isinstance(grantee, dict):
            errors.append("body.grantee must be a dict")

    return errors


def validate_capability_invocation(invocation: dict) -> list[str]:
    """Validate a gap:capability_invocation envelope.

    Runs the general envelope check then verifies the invocation-specific body
    fields: caller, capability, args.
    """
    errors = validate_cdro_envelope(invocation)

    inv_type = invocation.get("type")
    if inv_type is not None and inv_type != "gap:capability_invocation":
        errors.append(f"type must be 'gap:capability_invocation', got {inv_type!r}")

    body = invocation.get("body")
    if not isinstance(body, dict):
        errors.append("body must be a dict")
    else:
        for field in ("caller", "capability", "args"):
            if field not in body:
                errors.append(f"body missing required field: {field}")

        caller = body.get("caller")
        if caller is not None and not isinstance(caller, dict):
            errors.append("body.caller must be a dict")

    return errors


def validate_orchestration_chain(obj: dict) -> list[str]:
    """Validate a gap:orchestration_chain envelope.

    Required body fields: root_actor_oid, capability_name, final_invocation_oid,
    steps (list of delegation steps).
    Each step must carry step_index, delegator_actor_oid, delegatee_actor_oid,
    grant_oid, delegated_at_ms, step_signature, step_signature_alg.
    Maximum chain depth is 10 steps.
    """
    errors = validate_cdro_envelope(obj)

    obj_type = obj.get("type")
    if obj_type is not None and obj_type != "gap:orchestration_chain":
        errors.append(f"type must be 'gap:orchestration_chain', got {obj_type!r}")

    body = obj.get("body")
    if not isinstance(body, dict):
        errors.append("body must be a dict")
    else:
        for field in ("root_actor_oid", "capability_name", "final_invocation_oid", "steps"):
            if field not in body:
                errors.append(f"body missing required field: {field}")

        steps = body.get("steps")
        if steps is not None:
            if not isinstance(steps, list):
                errors.append("body.steps must be a list")
            elif len(steps) > 10:
                errors.append(f"delegation chain exceeds maximum depth of 10 (got {len(steps)})")
            else:
                step_fields = ("step_index", "delegator_actor_oid", "delegatee_actor_oid",
                               "grant_oid", "delegated_at_ms", "step_signature", "step_signature_alg")
                for i, step in enumerate(steps):
                    if not isinstance(step, dict):
                        errors.append(f"steps[{i}] must be a dict")
                    else:
                        for field in step_fields:
                            if field not in step:
                                errors.append(f"steps[{i}] missing required field: {field}")

    return errors


def validate_consent_record(obj: dict) -> list[str]:
    """Validate a gap:consent_record envelope.

    Required body fields: actor_oid, tenant_id, context, consented (bool),
    consented_at_ms.
    """
    errors = validate_cdro_envelope(obj)

    obj_type = obj.get("type")
    if obj_type is not None and obj_type != "gap:consent_record":
        errors.append(f"type must be 'gap:consent_record', got {obj_type!r}")

    body = obj.get("body")
    if not isinstance(body, dict):
        errors.append("body must be a dict")
    else:
        for field in ("actor_oid", "tenant_id", "context", "consented", "consented_at_ms"):
            if field not in body:
                errors.append(f"body missing required field: {field}")

        consented = body.get("consented")
        if consented is not None and not isinstance(consented, bool):
            errors.append("body.consented must be a boolean")

        consented_at = body.get("consented_at_ms")
        if consented_at is not None and not (isinstance(consented_at, int) and not isinstance(consented_at, bool)):
            errors.append("body.consented_at_ms must be a non-negative integer")

    return errors


def validate_pip_response(obj: dict) -> list[str]:
    """Validate a gap:pip_response envelope.

    Required body fields: pip_endpoint, request_args_hash, response_body_hash,
    evaluated_at_ms, cache_ttl_ms.
    """
    errors = validate_cdro_envelope(obj)

    obj_type = obj.get("type")
    if obj_type is not None and obj_type != "gap:pip_response":
        errors.append(f"type must be 'gap:pip_response', got {obj_type!r}")

    body = obj.get("body")
    if not isinstance(body, dict):
        errors.append("body must be a dict")
    else:
        for field in ("pip_endpoint", "request_args_hash", "response_body_hash",
                      "evaluated_at_ms", "cache_ttl_ms"):
            if field not in body:
                errors.append(f"body missing required field: {field}")

        cache_ttl = body.get("cache_ttl_ms")
        if cache_ttl is not None and not (isinstance(cache_ttl, int) and not isinstance(cache_ttl, bool)):
            errors.append("body.cache_ttl_ms must be an integer")

        args = body.get("args")
        if args is not None and not isinstance(args, dict):
            errors.append("body.args must be a dict")

    return errors
