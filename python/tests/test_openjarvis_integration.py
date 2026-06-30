"""Tests for synoi_gap.integrations.openjarvis.

Run with: python tests/test_openjarvis_integration.py
or:        pytest python/tests/test_openjarvis_integration.py
"""
import asyncio
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from synoi_gap.integrations.openjarvis import (
    CAPABILITY_MAP,
    capability_for_tool,
    safety_class_for_capability,
    build_invocation_envelope,
    denied_tool_result,
    GapToolHook,
)
from synoi_gap.oid import compute_gap_oid
from synoi_gap.validate import validate_capability_invocation


# ---------------------------------------------------------------------------
# Capability mapping
# ---------------------------------------------------------------------------

def test_known_tools_map_correctly():
    assert capability_for_tool("shell_exec") == "system.shell.exec"
    assert capability_for_tool("web_search") == "network.web.search"
    assert capability_for_tool("file_read") == "system.file.read"
    assert capability_for_tool("git_tool") == "system.git.operation"
    assert capability_for_tool("memory_manage") == "agent.memory.manage"


def test_unknown_tool_gets_openjarvis_prefix():
    cap = capability_for_tool("some_custom_plugin")
    assert cap == "openjarvis.some_custom_plugin"


def test_all_mapped_tools_have_dot_namespace():
    for tool_name, cap in CAPABILITY_MAP.items():
        assert "." in cap, f"{tool_name} maps to {cap!r} which has no dot namespace"


# ---------------------------------------------------------------------------
# Safety class
# ---------------------------------------------------------------------------

def test_shell_exec_is_class_c():
    assert safety_class_for_capability("system.shell.exec") == "C"


def test_docker_exec_is_class_c():
    assert safety_class_for_capability("system.docker.exec") == "C"


def test_file_write_is_class_c():
    assert safety_class_for_capability("system.file.write") == "C"


def test_web_search_is_class_b():
    assert safety_class_for_capability("network.web.search") == "B"


def test_file_read_is_class_b():
    assert safety_class_for_capability("system.file.read") == "B"


def test_unknown_capability_is_class_b():
    # Unknown capabilities default to B (gateway policy decides the real risk)
    assert safety_class_for_capability("openjarvis.some_plugin") == "B"


# ---------------------------------------------------------------------------
# Envelope builder
# ---------------------------------------------------------------------------

_ACTOR_OID = "sha256:" + "a" * 64
_GRANT_OID = "sha256:" + "b" * 64
_TENANT    = "tenant-test"


def _make_envelope(tool_name="shell_exec", tool_args=None):
    return build_invocation_envelope(
        tool_name=tool_name,
        tool_args=tool_args or {"command": "ls -la"},
        tenant_id=_TENANT,
        actor_oid=_ACTOR_OID,
        grant_oid=_GRANT_OID,
        created_at_ms=1_750_000_000_000,
    )


def test_envelope_type():
    env = _make_envelope()
    assert env["type"] == "gap:capability_invocation"


def test_envelope_gap_version():
    env = _make_envelope()
    assert env["gap_version"] == "1.0"


def test_envelope_tenant_id():
    env = _make_envelope()
    assert env["tenant_id"] == _TENANT


def test_envelope_oid_format():
    env = _make_envelope()
    assert env["oid"].startswith("sha256:")
    assert len(env["oid"]) == 71  # "sha256:" + 64 hex chars


def test_envelope_oid_is_content_addressed():
    env = _make_envelope()
    # Recompute and verify it matches
    recomputed = compute_gap_oid(env)
    assert recomputed == env["oid"]


def test_envelope_oid_changes_with_different_args():
    env1 = _make_envelope(tool_args={"command": "ls"})
    env2 = _make_envelope(tool_args={"command": "rm -rf /"})
    assert env1["oid"] != env2["oid"]


def test_envelope_capability_mapped():
    env = _make_envelope(tool_name="shell_exec")
    assert env["body"]["capability"] == "system.shell.exec"


def test_envelope_unknown_tool_capability():
    env = _make_envelope(tool_name="my_custom_tool")
    assert env["body"]["capability"] == "openjarvis.my_custom_tool"


def test_envelope_safety_class_c_for_shell():
    env = _make_envelope(tool_name="shell_exec")
    assert env["body"]["safety_class"] == "C"


def test_envelope_safety_class_b_for_search():
    env = _make_envelope(tool_name="web_search", tool_args={"query": "test"})
    assert env["body"]["safety_class"] == "B"


def test_envelope_caller_shape():
    env = _make_envelope()
    caller = env["body"]["caller"]
    assert caller["actor_type"] == "agent"
    assert caller["actor_oid"] == _ACTOR_OID
    assert caller["grant_oid"] == _GRANT_OID


def test_envelope_args_contains_tool_name_and_input():
    env = _make_envelope(tool_name="shell_exec", tool_args={"command": "echo hi"})
    args = env["body"]["args"]
    assert args["tool_name"] == "shell_exec"
    assert args["tool_input"] == {"command": "echo hi"}


def test_envelope_passes_gap_validator():
    env = _make_envelope()
    errors = validate_capability_invocation(env)
    assert errors == [], f"Validation errors: {errors}"


def test_envelope_framework_context():
    env = _make_envelope()
    assert env["body"]["context"]["framework"] == "openjarvis"


# ---------------------------------------------------------------------------
# denied_tool_result
# ---------------------------------------------------------------------------

def test_denied_result_contains_tool_name():
    result = denied_tool_result("shell_exec")
    assert "shell_exec" in result["output"]


def test_denied_result_gap_denied_flag():
    result = denied_tool_result("shell_exec")
    assert result["gap_denied"] is True


def test_denied_result_with_receipt_oid():
    oid = "sha256:" + "c" * 64
    result = denied_tool_result("shell_exec", receipt_oid=oid)
    assert oid in result["output"]


def test_denied_result_without_receipt_oid():
    result = denied_tool_result("shell_exec")
    assert "Receipt" not in result["output"]


# ---------------------------------------------------------------------------
# GapToolHook (mock gateway client)
# ---------------------------------------------------------------------------

class _MockGapClient:
    """Minimal mock that records invoke calls and returns a preset response."""

    def __init__(self, invoke_response: dict, poll_responses: list[dict] = None):
        self._invoke_response = invoke_response
        self._poll_responses = list(poll_responses or [])
        self._poll_idx = 0
        self.invocations: list[dict] = []

    async def invoke(self, envelope: dict) -> dict:
        self.invocations.append(envelope)
        return self._invoke_response

    async def get_receipt(self, oid: str) -> dict:
        if self._poll_idx < len(self._poll_responses):
            resp = self._poll_responses[self._poll_idx]
            self._poll_idx += 1
            return resp
        return {"status": "denied"}


def _run(coro):
    return asyncio.run(coro)


def _make_hook(invoke_response: dict, poll_responses: list = None, **kwargs) -> tuple:
    client = _MockGapClient(invoke_response, poll_responses)
    hook = GapToolHook(
        client=client,
        tenant_id=_TENANT,
        actor_oid=_ACTOR_OID,
        grant_oid=_GRANT_OID,
        hitl_poll_interval=0.01,
        hitl_timeout=0.5,
        **kwargs,
    )
    return hook, client


def test_hook_allows_on_allowed():
    hook, client = _make_hook({"status": "allowed", "oid": "sha256:" + "d" * 64})
    result = _run(hook("web_search", {"query": "test"}))
    assert result is True


def test_hook_denies_on_denied():
    hook, _ = _make_hook({"status": "denied", "oid": "sha256:" + "e" * 64})
    result = _run(hook("shell_exec", {"command": "rm -rf /"}))
    assert result is False


def test_hook_sends_correct_envelope():
    hook, client = _make_hook({"status": "allowed", "oid": "sha256:" + "f" * 64})
    _run(hook("file_read", {"path": "/etc/passwd"}))
    assert len(client.invocations) == 1
    env = client.invocations[0]
    assert env["type"] == "gap:capability_invocation"
    assert env["body"]["capability"] == "system.file.read"
    assert env["body"]["args"]["tool_name"] == "file_read"


def test_hook_allows_after_hitl_approval():
    # Gateway defers, then polling returns approved
    hook, _ = _make_hook(
        invoke_response={"status": "deferred", "oid": "sha256:" + "a" * 64},
        poll_responses=[
            {"status": "deferred"},
            {"status": "approved"},
        ],
    )
    result = _run(hook("shell_exec", {"command": "ls"}))
    assert result is True


def test_hook_denies_after_hitl_denial():
    hook, _ = _make_hook(
        invoke_response={"status": "deferred", "oid": "sha256:" + "a" * 64},
        poll_responses=[{"status": "denied"}],
    )
    result = _run(hook("shell_exec", {"command": "ls"}))
    assert result is False


def test_hook_denies_on_hitl_timeout():
    # Poll responses never resolve -- timeout fires
    client = _MockGapClient(
        {"status": "deferred", "oid": "sha256:" + "a" * 64},
        [],
    )
    hook = GapToolHook(
        client=client,
        tenant_id=_TENANT,
        actor_oid=_ACTOR_OID,
        grant_oid=_GRANT_OID,
        hitl_poll_interval=0.01,
        hitl_timeout=0.05,
    )
    result = _run(hook("shell_exec", {"command": "ls"}))
    assert result is False


def test_hook_denies_on_gateway_error_by_default():
    class _ErrorClient:
        async def invoke(self, _): raise RuntimeError("connection refused")
        async def get_receipt(self, _): raise RuntimeError("connection refused")

    hook = GapToolHook(
        client=_ErrorClient(),
        tenant_id=_TENANT,
        actor_oid=_ACTOR_OID,
        grant_oid=_GRANT_OID,
    )
    result = _run(hook("shell_exec", {"command": "ls"}))
    assert result is False


def test_hook_allows_on_gateway_error_when_permissive():
    class _ErrorClient:
        async def invoke(self, _): raise RuntimeError("connection refused")
        async def get_receipt(self, _): raise RuntimeError("connection refused")

    hook = GapToolHook(
        client=_ErrorClient(),
        tenant_id=_TENANT,
        actor_oid=_ACTOR_OID,
        grant_oid=_GRANT_OID,
        deny_on_unknown_capability=False,
    )
    result = _run(hook("shell_exec", {"command": "ls"}))
    assert result is True


def test_hook_handles_body_status_shape():
    # Some gateway responses nest status inside body
    hook, _ = _make_hook({"body": {"status": "allowed"}, "oid": "sha256:" + "g" * 64})
    result = _run(hook("web_search", {"query": "test"}))
    assert result is True


if __name__ == "__main__":
    test_known_tools_map_correctly()
    test_unknown_tool_gets_openjarvis_prefix()
    test_all_mapped_tools_have_dot_namespace()
    test_shell_exec_is_class_c()
    test_docker_exec_is_class_c()
    test_file_write_is_class_c()
    test_web_search_is_class_b()
    test_file_read_is_class_b()
    test_unknown_capability_is_class_b()
    test_envelope_type()
    test_envelope_gap_version()
    test_envelope_tenant_id()
    test_envelope_oid_format()
    test_envelope_oid_is_content_addressed()
    test_envelope_oid_changes_with_different_args()
    test_envelope_capability_mapped()
    test_envelope_unknown_tool_capability()
    test_envelope_safety_class_c_for_shell()
    test_envelope_safety_class_b_for_search()
    test_envelope_caller_shape()
    test_envelope_args_contains_tool_name_and_input()
    test_envelope_passes_gap_validator()
    test_envelope_framework_context()
    test_denied_result_contains_tool_name()
    test_denied_result_gap_denied_flag()
    test_denied_result_with_receipt_oid()
    test_denied_result_without_receipt_oid()
    test_hook_allows_on_allowed()
    test_hook_denies_on_denied()
    test_hook_sends_correct_envelope()
    test_hook_allows_after_hitl_approval()
    test_hook_denies_after_hitl_denial()
    test_hook_denies_on_hitl_timeout()
    test_hook_denies_on_gateway_error_by_default()
    test_hook_allows_on_gateway_error_when_permissive()
    test_hook_handles_body_status_shape()
    print("All OpenJarvis integration tests passed")
