"""
synoi_gap.integrations.openjarvis
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

GAP governance hook for OpenJarvis agents.

Provides GapToolHook -- an async callable that intercepts OpenJarvis tool
execution, creates a GAP capability invocation CDRO, posts it to a
GAP-conformant gateway, and blocks or allows the tool call based on the
returned decision receipt.

When the gateway returns status "deferred" the hook polls until a human
approves or denies via any configured HITL surface (SMS, Slack, dashboard).

Usage (after the OpenJarvis before_tool_call PR is merged)::

    import asyncio
    from synoi_gap.client import GapClient
    from synoi_gap.integrations.openjarvis import GapToolHook

    async def main():
        async with GapClient(
            base_url="https://gateway.synoi.systems/v1/gap",
            token="synoi-sk-...",
            tenant_id="tenant-abc",
        ) as gap:
            hook = GapToolHook(
                client=gap,
                tenant_id="tenant-abc",
                actor_oid="sha256:<agent-oid>",
                grant_oid="sha256:<pre-issued-grant-oid>",
            )
            agent = OrchestratorAgent(..., before_tool_call=hook)
            result = await agent.run("do the thing")

    asyncio.run(main())

Without the upstream hook point the hook can also be called manually before
each tool execution in a custom agent loop.
"""
from __future__ import annotations

import asyncio
import time
from typing import Any, Optional, TYPE_CHECKING

from synoi_gap.oid import compute_gap_oid

if TYPE_CHECKING:
    from synoi_gap.client import GapClient

# ---------------------------------------------------------------------------
# Capability mapping: OpenJarvis tool name -> GAP capability name
# ---------------------------------------------------------------------------

CAPABILITY_MAP: dict[str, str] = {
    # Execution
    "shell_exec":         "system.shell.exec",
    "docker_shell_exec":  "system.docker.exec",
    "code_interpreter":   "system.code.interpret",
    "repl":               "system.repl.execute",
    "apply_patch":        "system.file.patch",
    # File system
    "file_read":          "system.file.read",
    "file_write":         "system.file.write",
    "storage_tools":      "system.storage.manage",
    # Network
    "web_search":         "network.web.search",
    "browser":            "network.browser.navigate",
    "browser_axtree":     "network.browser.navigate",
    "http_request":       "network.http.request",
    # Data
    "db_query":           "data.database.query",
    "knowledge_search":   "data.knowledge.search",
    "knowledge_sql":      "data.knowledge.query",
    "retrieval":          "data.retrieval.semantic",
    # Media
    "pdf_tool":           "data.document.read",
    "image_tool":         "data.image.process",
    "audio_tool":         "data.audio.process",
    "text_to_speech":     "data.audio.synthesize",
    # Development
    "git_tool":           "system.git.operation",
    # Agent / memory
    "memory_manage":      "agent.memory.manage",
    "user_profile_manage": "agent.profile.manage",
    "skill_manage":       "agent.skill.manage",
    "channel_tools":      "agent.channel.send",
    # Misc
    "calculator":         "util.math.compute",
    "think":              "agent.reasoning.internal",
    "approval_store":     "agent.approval.record",
    "mcp_adapter":        "agent.mcp.invoke",
    "scheduling":         "agent.scheduler.manage",
}

# Capabilities that default to safety class C (require explicit human approval)
_CLASS_C: frozenset[str] = frozenset({
    "system.shell.exec",
    "system.docker.exec",
    "system.file.patch",
    "system.file.write",
    "system.git.operation",
    "network.http.request",
    "data.database.query",
    "agent.skill.manage",
    "agent.channel.send",
})


def capability_for_tool(tool_name: str) -> str:
    """Return the GAP capability name for an OpenJarvis tool.

    Falls back to ``openjarvis.<tool_name>`` for unrecognised tools so
    unknown tools still produce valid CDROs -- they'll be evaluated by the
    gateway's policy for unknown capabilities (default: require grant).
    """
    return CAPABILITY_MAP.get(tool_name, f"openjarvis.{tool_name}")


def safety_class_for_capability(capability: str) -> str:
    """Return 'C' (HITL required) or 'B' (receipt only, no human gate)."""
    return "C" if capability in _CLASS_C else "B"


# ---------------------------------------------------------------------------
# CDRO builder
# ---------------------------------------------------------------------------

def build_invocation_envelope(
    *,
    tool_name: str,
    tool_args: dict[str, Any],
    tenant_id: str,
    actor_oid: str,
    grant_oid: str,
    created_at_ms: Optional[int] = None,
) -> dict[str, Any]:
    """Build a gap:capability_invocation CDRO for an OpenJarvis tool call.

    The returned envelope has a valid content-addressed OID. Pass it directly
    to ``GapClient.invoke()``.

    Parameters
    ----------
    tool_name:
        The OpenJarvis tool name (e.g. ``"shell_exec"``).
    tool_args:
        The arguments dict the agent is passing to the tool.
    tenant_id:
        Owning tenant.
    actor_oid:
        OID of the calling agent (``sha256:<hex>``).
    grant_oid:
        OID of the pre-issued capability grant that authorises this call.
    created_at_ms:
        Unix timestamp in milliseconds. Defaults to ``int(time.time() * 1000)``.
    """
    capability = capability_for_tool(tool_name)
    now_ms = created_at_ms if created_at_ms is not None else int(time.time() * 1000)

    body: dict[str, Any] = {
        "caller": {
            "actor_type": "agent",
            "actor_oid": actor_oid,
            "grant_oid": grant_oid,
        },
        "capability": capability,
        "safety_class": safety_class_for_capability(capability),
        "args": {
            "tool_name": tool_name,
            "tool_input": tool_args,
        },
        "context": {
            "framework": "openjarvis",
        },
    }

    envelope: dict[str, Any] = {
        "type": "gap:capability_invocation",
        "gap_version": "1.0",
        "tenant_id": tenant_id,
        "created_at_ms": now_ms,
        "created_by": actor_oid,
        "body": body,
    }

    envelope["oid"] = compute_gap_oid(envelope)
    return envelope


# ---------------------------------------------------------------------------
# GapToolHook
# ---------------------------------------------------------------------------

class GapToolHook:
    """Async callable that governs OpenJarvis tool execution via GAP.

    Wire it into an OpenJarvis ``OrchestratorAgent`` via the
    ``before_tool_call`` parameter once that hook lands in upstream
    OpenJarvis. Until then, call it manually before each tool execution.

    The hook returns ``True`` to allow execution and ``False`` to block it.
    On ``False`` the caller should inject a synthetic denied result back into
    the agent loop rather than executing the tool.

    Parameters
    ----------
    client:
        An open ``GapClient`` instance (use as async context manager).
    tenant_id:
        Owning tenant.
    actor_oid:
        Content-addressed OID of the calling agent (``sha256:<hex>``).
    grant_oid:
        OID of the pre-issued ``gap:capability_grant`` that covers this agent.
    hitl_poll_interval:
        Seconds between polls when a decision is deferred to HITL.
    hitl_timeout:
        Maximum seconds to wait for a human decision before treating it as
        denied. Default 300 (5 minutes).
    deny_on_unknown_capability:
        When ``True`` (default), capabilities not in ``CAPABILITY_MAP`` that
        produce a gateway error are denied. When ``False`` they are allowed
        (permissive fallback). Leave ``True`` in production.
    """

    def __init__(
        self,
        client: "GapClient",
        tenant_id: str,
        actor_oid: str,
        grant_oid: str,
        hitl_poll_interval: float = 3.0,
        hitl_timeout: float = 300.0,
        deny_on_unknown_capability: bool = True,
    ) -> None:
        self._client = client
        self._tenant_id = tenant_id
        self._actor_oid = actor_oid
        self._grant_oid = grant_oid
        self._hitl_poll_interval = hitl_poll_interval
        self._hitl_timeout = hitl_timeout
        self._deny_on_unknown = deny_on_unknown_capability

    async def __call__(self, tool_name: str, tool_args: dict[str, Any]) -> bool:
        """Evaluate a tool call against the GAP gateway.

        Returns ``True`` to allow the tool to execute, ``False`` to block it.
        Blocks (polling) when the gateway defers to a HITL surface.
        """
        envelope = build_invocation_envelope(
            tool_name=tool_name,
            tool_args=tool_args,
            tenant_id=self._tenant_id,
            actor_oid=self._actor_oid,
            grant_oid=self._grant_oid,
        )

        try:
            response = await self._client.invoke(envelope)
        except Exception as exc:
            if self._deny_on_unknown:
                return False
            # Permissive fallback: log and allow
            import sys
            sys.stderr.write(f"[synoi-gap] gateway error for {tool_name}: {exc}\n")
            return True

        status = self._extract_status(response)

        if status == "allowed":
            return True

        if status == "denied":
            return False

        if status == "deferred":
            receipt_oid = response.get("oid") or response.get("receipt_oid")
            if receipt_oid:
                resolved = await self._poll_hitl(receipt_oid)
                return resolved == "approved"
            return False

        # Unknown status - treat as deny
        return False

    async def _poll_hitl(self, receipt_oid: str) -> str:
        """Poll the gateway until the HITL decision resolves.

        Returns ``"approved"``, ``"denied"``, or ``"timeout"``.
        """
        deadline = time.monotonic() + self._hitl_timeout
        while time.monotonic() < deadline:
            try:
                receipt = await self._client.get_receipt(receipt_oid)
                status = self._extract_status(receipt)
                if status in ("approved", "denied", "expired"):
                    return "approved" if status == "approved" else "denied"
            except Exception:
                pass
            await asyncio.sleep(self._hitl_poll_interval)
        return "timeout"

    @staticmethod
    def _extract_status(response: dict) -> str:
        """Pull the decision status out of a gateway response envelope."""
        # Try top-level status first, then body.status (both shapes appear in the gateway)
        status = response.get("status")
        if not status:
            status = response.get("body", {}).get("status")
        return str(status).lower() if status else "unknown"


# ---------------------------------------------------------------------------
# Sync wrapper
# ---------------------------------------------------------------------------

class SyncGapToolHook:
    """Synchronous wrapper around GapToolHook for use in non-async agent loops.

    Internally runs an event loop for each call. Only use this when you
    cannot run inside an existing async event loop (e.g. a sync agent loop).
    If the caller is already async, use GapToolHook directly.
    """

    def __init__(self, hook: GapToolHook) -> None:
        self._hook = hook

    def __call__(self, tool_name: str, tool_args: dict[str, Any]) -> bool:
        return asyncio.run(self._hook(tool_name, tool_args))


# ---------------------------------------------------------------------------
# Denial result builder
# ---------------------------------------------------------------------------

def denied_tool_result(tool_name: str, receipt_oid: Optional[str] = None) -> dict[str, Any]:
    """Build the synthetic tool result to inject when GAP denies a tool call.

    The result is formatted to match OpenJarvis's tool result shape so the
    LLM receives a clear denial message rather than an execution error.

    Parameters
    ----------
    tool_name:
        The tool that was denied.
    receipt_oid:
        The GAP decision receipt OID, if available (included for auditability).
    """
    body = f"[GAP] Tool call '{tool_name}' was denied by governance policy."
    if receipt_oid:
        body += f" Receipt: {receipt_oid}"
    return {
        "tool_name": tool_name,
        "output": body,
        "error": "governance_denied",
        "gap_denied": True,
    }
