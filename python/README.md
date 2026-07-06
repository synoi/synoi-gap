# synoi-gap Python SDK

Python SDK for the GAP (Governed Action Protocol). Provides OID computation,
shape validators, and a thin async HTTP client for GAP-conformant gateways.

## Install

```sh
pip install synoi-gap          # core: OID + validators, no dependencies
pip install synoi-gap[http]    # adds httpx for GapClient
```

Requires Python 3.9 or later.

## OID computation

```python
from synoi_gap import compute_gap_oid

payload = {
    "type": "gap:capability_declaration",
    "tenant_id": "tenant-abc",
    "created_at_ms": 1750000000000,
    "created_by": "sha256:actor...",
    "body": {
        "actor_type": "service",
        "actor_id": "my-service",
        "actor_name": "My Service",
        "actor_version": "1.0.0",
        "capabilities": [{"capability": "skill.create"}],
    },
}

oid = compute_gap_oid(payload)
# "sha256:<64 hex chars>"
```

The excluded fields (`oid`, `gap_version`, `signature`, `signature_key_id`,
`supersedes`) are stripped automatically before hashing. You can pass the full
envelope or the stripped payload: the result is the same.

## Validators

```python
from synoi_gap import validate_cdro_envelope, validate_capability_declaration

errors = validate_cdro_envelope(envelope)
if errors:
    raise ValueError(errors)

errors = validate_capability_declaration(decl)
```

Validators return a list of error strings. An empty list means the shape is
valid. They are **not exhaustive** and do not certify GAP conformance: they
catch the fields most commonly omitted by new implementors. For full
conformance checking, run against a L1+ conformant gateway or the
TypeScript validators in `@synoi/gap`.

## GapClient (async HTTP)

```python
import asyncio
from synoi_gap.client import GapClient

async def main():
    async with GapClient(
        base_url="https://gateway.synoi.systems/v1/gap",
        token="synoi-sk-...",
        tenant_id="tenant-abc",
    ) as client:
        # Phase 1: declare
        decl = await client.post_declaration(declaration_envelope)

        # Phase 2: grant
        grant = await client.post_grant(grant_envelope)

        # Phase 3: invoke
        receipt = await client.invoke(invocation_envelope)

        # Phase 4: read receipt
        full_receipt = await client.get_receipt(receipt["oid"])

asyncio.run(main())
```

See `synoi_gap/client.py` for the full method list (revocation, workflow
signals, key fetch).

## OpenJarvis integration

`synoi_gap.integrations.openjarvis` provides a drop-in governance hook for
OpenJarvis agents. Wire it into `OrchestratorAgent` via the `before_tool_call`
parameter (see [examples/openjarvis_pr_patch.py](examples/openjarvis_pr_patch.py)
for the upstream PR that adds that hook).

```python
import asyncio
from synoi_gap.client import GapClient
from synoi_gap.integrations.openjarvis import GapToolHook, denied_tool_result

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
            grant_oid="sha256:<grant-oid>",
        )

        # With the upstream hook wired:
        agent = OrchestratorAgent(engine, tools=tools, before_tool_call=hook)
        await agent.run("do the thing")

        # Or call manually before each tool:
        allowed = await hook("shell_exec", {"command": "ls -la"})
        if not allowed:
            result = denied_tool_result("shell_exec")

asyncio.run(main())
```

**Capability map:** 30 OpenJarvis tool names are mapped to GAP capability
names (e.g. `shell_exec` -> `system.shell.exec`). Unknown tools map to
`openjarvis.<tool_name>` and are evaluated by gateway policy.

**Safety classes:** 9 tools are Class C (HITL required before execution):
`shell_exec`, `docker_shell_exec`, `file_write`, `apply_patch`, `git_tool`,
`http_request`, `db_query`, `channel_tools`, `skill_manage`. All others are
Class B (receipt issued, no human gate).

**HITL polling:** when the gateway defers a Class C decision, the hook polls
`/receipts/{oid}` until a human approves or denies via SMS, Slack, or
dashboard. Default timeout is 300 seconds; configurable via `hitl_timeout`.

See [examples/openjarvis_example.py](examples/openjarvis_example.py) for a
runnable dry-run demo (no credentials needed).

## License

Apache-2.0
