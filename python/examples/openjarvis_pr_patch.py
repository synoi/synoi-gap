"""
OpenJarvis PR: before_tool_call hook
=====================================

This file shows the exact change we propose to OpenJarvis's
OrchestratorAgent to add a before_tool_call hook point.

It is NOT a diff file -- it is a readable illustration of the two changes:

  1. OrchestratorAgent.__init__() accepts an optional before_tool_call callable.
  2. The tool execution loop calls it before each tool runs.

The hook signature:

    async before_tool_call(tool_name: str, tool_args: dict) -> bool

Returns True to allow execution, False to block it. When False the agent loop
substitutes a synthetic denial result so the LLM knows the tool was blocked.

The change is ~25 lines across two locations in agents/orchestrator.py.
No changes to any other file. The hook is entirely optional -- existing users
see no behaviour change.

PR title:    feat: add optional before_tool_call governance hook to OrchestratorAgent
PR body:     see below
"""

# ---------------------------------------------------------------------------
# agents/orchestrator.py  -- CHANGE 1: __init__ signature
# ---------------------------------------------------------------------------

# BEFORE:
#
#   def __init__(
#       self,
#       engine,
#       tools=None,
#       system_prompt=None,
#       max_turns=10,
#   ):
#       self.engine       = engine
#       self.tools        = tools or []
#       self.system_prompt = system_prompt
#       self.max_turns    = max_turns

# AFTER:

from __future__ import annotations
from typing import Any, Awaitable, Callable, Optional


class OrchestratorAgentPatch:
    """Illustrative patch -- not the full OrchestratorAgent implementation."""

    def __init__(
        self,
        engine,
        tools=None,
        system_prompt=None,
        max_turns=10,
        # NEW: optional async governance hook
        before_tool_call: Optional[
            Callable[[str, dict[str, Any]], Awaitable[bool]]
        ] = None,
    ):
        self.engine           = engine
        self.tools            = tools or []
        self.system_prompt    = system_prompt
        self.max_turns        = max_turns
        self.before_tool_call = before_tool_call  # NEW

    # CHANGE 2: tool execution loop
    #
    # BEFORE (pseudocode of the existing loop body):
    #
    #   for tool_call in tool_calls:
    #       tool_name   = tool_call["function"]["name"]
    #       tool_args   = json.loads(tool_call["function"]["arguments"])
    #       tool_result = self._execute_tool(tool_name, tool_args)
    #       results.append({"tool_call_id": tool_call["id"], "output": tool_result})
    #
    # AFTER:

    async def _run_tool_call_with_hook(
        self,
        tool_call: dict[str, Any],
        execute_fn,
    ) -> dict[str, Any]:
        """Run one tool call through the governance hook then execute.

        Parameters
        ----------
        tool_call:
            The tool_call object from the LLM response
            (shape: {"id": ..., "function": {"name": ..., "arguments": ...}}).
        execute_fn:
            The existing tool executor callable: execute_fn(name, args) -> result.

        Returns
        -------
        dict with tool_call_id and output, ready to append to the message list.
        """
        import json

        tool_name = tool_call["function"]["name"]
        try:
            tool_args = json.loads(tool_call["function"]["arguments"])
        except (json.JSONDecodeError, KeyError):
            tool_args = {}

        # Governance gate -- only present when caller supplied a hook
        if self.before_tool_call is not None:
            allowed = await self.before_tool_call(tool_name, tool_args)
            if not allowed:
                # Inject a synthetic denial so the LLM gets a clear signal
                denial_output = (
                    f"[Governance] Tool '{tool_name}' was not approved. "
                    "Adjust your plan and try a different approach."
                )
                return {
                    "tool_call_id": tool_call.get("id", ""),
                    "role": "tool",
                    "name": tool_name,
                    "content": denial_output,
                }

        result = await execute_fn(tool_name, tool_args)
        return {
            "tool_call_id": tool_call.get("id", ""),
            "role": "tool",
            "name": tool_name,
            "content": result,
        }


# ---------------------------------------------------------------------------
# PR body (paste into GitHub)
# ---------------------------------------------------------------------------

PR_BODY = """
## Summary

- Adds an optional `before_tool_call` async hook to `OrchestratorAgent`
- The hook receives `(tool_name: str, tool_args: dict) -> bool`
- Returning `False` injects a governance denial message instead of executing
- No behaviour change for existing users (hook defaults to `None`)

## Why

Governance and audit layers (e.g. [GAP -- Governed Action Protocol](https://github.com/open-jarvis/OpenJarvis/pull/TODO))
need to intercept tool execution before it happens, not after. The Merkle
audit log records what happened; a `before_tool_call` hook records what was
**authorised** before it happened. These are different claims.

The hook is the minimal surface needed. All governance logic stays in the
caller-supplied function -- OpenJarvis itself remains neutral.

## Reference implementation

`pip install synoi-gap` provides a drop-in hook implementation:

```python
from synoi_gap.client import GapClient
from synoi_gap.integrations.openjarvis import GapToolHook

async with GapClient(base_url=..., token=..., tenant_id=...) as gap:
    hook  = GapToolHook(client=gap, tenant_id=..., actor_oid=..., grant_oid=...)
    agent = OrchestratorAgent(engine, tools=tools, before_tool_call=hook)
    await agent.run("do the thing")
```

Every tool call becomes a signed, content-addressed decision receipt.
Class C tools (shell, file write, HTTP, git) require human approval via
SMS, Slack interactive buttons, or the dashboard before executing.

## Test plan

- [ ] Existing tests pass unchanged (hook=None path is identical to current)
- [ ] New unit test: hook returning True allows execution
- [ ] New unit test: hook returning False injects denial, tool not called
- [ ] New unit test: async hook is awaited correctly
- [ ] Manual: wire synoi-gap hook, verify Class C tool blocks until SMS Y/N
"""


if __name__ == "__main__":
    print("PR title:")
    print("  feat: add optional before_tool_call governance hook to OrchestratorAgent")
    print()
    print("PR body:")
    print(PR_BODY)
