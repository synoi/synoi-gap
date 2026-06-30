"""
GAP + OpenJarvis: end-to-end governance example
================================================

Shows how to wire GapToolHook into an OpenJarvis OrchestratorAgent once the
before_tool_call hook lands in upstream OpenJarvis (see openjarvis_pr_patch.py).

Run against a live SynOI gateway:

    export GAP_BASE_URL=https://gateway.synoi.systems/v1/gap
    export GAP_TOKEN=synoi-sk-...
    export GAP_TENANT_ID=tenant-abc
    export GAP_ACTOR_OID=sha256:...      # your agent's OID
    export GAP_GRANT_OID=sha256:...      # pre-issued capability grant OID
    python examples/openjarvis_example.py

Without a live gateway the script runs in DRY_RUN mode and prints what it
would have sent without making any network calls.
"""
import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from synoi_gap.integrations.openjarvis import (
    GapToolHook,
    build_invocation_envelope,
    denied_tool_result,
    capability_for_tool,
    safety_class_for_capability,
    CAPABILITY_MAP,
)

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

BASE_URL  = os.getenv("GAP_BASE_URL",  "https://gateway.synoi.systems/v1/gap")
TOKEN     = os.getenv("GAP_TOKEN",     "")
TENANT_ID = os.getenv("GAP_TENANT_ID", "tenant-demo")
ACTOR_OID = os.getenv("GAP_ACTOR_OID", "sha256:" + "0" * 64)
GRANT_OID = os.getenv("GAP_GRANT_OID", "sha256:" + "1" * 64)

DRY_RUN = not TOKEN


# ---------------------------------------------------------------------------
# Dry-run mock client
# ---------------------------------------------------------------------------

class _DryRunClient:
    """Prints what would be sent and returns a static allowed response."""

    async def invoke(self, envelope: dict) -> dict:
        print("\n[DRY RUN] Would POST to /invoke:")
        print(json.dumps(envelope, indent=2))
        capability = envelope["body"]["capability"]
        safety     = envelope["body"]["safety_class"]
        if safety == "C":
            print(f"\n[DRY RUN] Class C capability ({capability}) -- would trigger HITL")
            return {"status": "deferred", "oid": "sha256:" + "f" * 64}
        print(f"\n[DRY RUN] Class B capability ({capability}) -- allowed immediately")
        return {"status": "allowed", "oid": "sha256:" + "e" * 64}

    async def get_receipt(self, oid: str) -> dict:
        # Simulate a human approving after one poll
        print(f"\n[DRY RUN] Polling receipt {oid} -- returning approved")
        return {"status": "approved"}

    async def __aenter__(self): return self
    async def __aexit__(self, *_): pass


# ---------------------------------------------------------------------------
# Simulated OpenJarvis tool loop
# ---------------------------------------------------------------------------

async def simulate_agent_loop(hook: GapToolHook) -> None:
    """
    Simulates what OrchestratorAgent's tool loop does when before_tool_call
    is wired in. Each tool call is governed before execution.
    """
    tool_calls = [
        # Class B -- should be allowed immediately
        ("web_search",    {"query": "OpenJarvis GAP integration"}),
        ("file_read",     {"path": "/tmp/config.json"}),
        # Class C -- triggers HITL in a live environment
        ("shell_exec",    {"command": "ls -la /etc"}),
        ("file_write",    {"path": "/tmp/output.txt", "content": "hello"}),
        # Unknown tool -- maps to openjarvis. namespace
        ("custom_plugin", {"action": "run"}),
    ]

    print("=" * 60)
    print("Simulated OpenJarvis agent tool loop with GAP governance")
    print("=" * 60)

    for tool_name, tool_args in tool_calls:
        cap   = capability_for_tool(tool_name)
        cls   = safety_class_for_capability(cap)
        print(f"\n> Tool: {tool_name}  ({cap}, Class {cls})")

        allowed = await hook(tool_name, tool_args)

        if allowed:
            print(f"  GAP: ALLOWED -- executing {tool_name}")
            # In a real loop the tool would execute here
        else:
            result = denied_tool_result(tool_name)
            print(f"  GAP: DENIED  -- injecting synthetic result: {result['output']}")


# ---------------------------------------------------------------------------
# Envelope inspection (no network needed)
# ---------------------------------------------------------------------------

def show_envelope_examples() -> None:
    print("\n" + "=" * 60)
    print("Example invocation CDROs")
    print("=" * 60)

    examples = [
        ("shell_exec",   {"command": "ls -la /etc"},         "Class C -- triggers HITL"),
        ("web_search",   {"query": "quarterly earnings"},     "Class B -- receipt only"),
        ("file_write",   {"path": "/var/log/x", "content": "y"}, "Class C -- triggers HITL"),
        ("custom_thing", {"param": "value"},                  "Unknown -- openjarvis. namespace"),
    ]

    for tool_name, args, note in examples:
        env = build_invocation_envelope(
            tool_name=tool_name,
            tool_args=args,
            tenant_id=TENANT_ID,
            actor_oid=ACTOR_OID,
            grant_oid=GRANT_OID,
            created_at_ms=1_750_000_000_000,
        )
        print(f"\n-- {tool_name} ({note})")
        print(f"   capability:   {env['body']['capability']}")
        print(f"   safety_class: {env['body']['safety_class']}")
        print(f"   oid:          {env['oid']}")


# ---------------------------------------------------------------------------
# Capability map summary
# ---------------------------------------------------------------------------

def show_capability_map() -> None:
    print("\n" + "=" * 60)
    print(f"OpenJarvis capability map ({len(CAPABILITY_MAP)} tools)")
    print("=" * 60)
    class_c_count = 0
    for tool, cap in sorted(CAPABILITY_MAP.items()):
        cls = safety_class_for_capability(cap)
        marker = " [C]" if cls == "C" else "    "
        print(f"  {marker} {tool:<25} -> {cap}")
        if cls == "C":
            class_c_count += 1
    print(f"\n  {class_c_count} Class C (HITL required), "
          f"{len(CAPABILITY_MAP) - class_c_count} Class B (receipt only)")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

async def main() -> None:
    show_envelope_examples()
    show_capability_map()

    if DRY_RUN:
        print("\n[DRY RUN] No GAP_TOKEN set -- using dry-run mock client")
        client = _DryRunClient()
    else:
        from synoi_gap.client import GapClient
        client = GapClient(base_url=BASE_URL, token=TOKEN, tenant_id=TENANT_ID)

    async with client:
        hook = GapToolHook(
            client=client,
            tenant_id=TENANT_ID,
            actor_oid=ACTOR_OID,
            grant_oid=GRANT_OID,
            hitl_poll_interval=3.0,
            hitl_timeout=300.0,
        )
        await simulate_agent_loop(hook)

    print("\nDone.")


if __name__ == "__main__":
    asyncio.run(main())
