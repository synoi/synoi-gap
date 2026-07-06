"""
GapClient -- thin async HTTP wrapper for a GAP-conformant gateway.

Requires the optional http dependency:
    pip install synoi-gap[http]

Usage::

    import asyncio
    from synoi_gap.client import GapClient

    async def main():
        async with GapClient(
            base_url="https://gateway.synoi.systems/v1/gap",
            token="synoi-sk-...",
            tenant_id="tenant-abc",
        ) as client:
            decl = await client.post_declaration(envelope)
            grant = await client.post_grant(grant_envelope)
            receipt = await client.invoke(invocation_envelope)

    asyncio.run(main())
"""
from __future__ import annotations

from typing import Any, Optional

try:
    import httpx
    _HAS_HTTPX = True
except ImportError:
    _HAS_HTTPX = False


class GapClient:
    """Async HTTP client for a GAP-conformant gateway.

    Covers the core declare/grant/invoke/receipt lifecycle; workflow and key
    management endpoints are not yet fully implemented (post_workflow_definition,
    start_workflow, list_transitions, get_key_by_id, list_revocations are absent).

    The client does not modify envelopes -- callers are responsible for
    computing OIDs (use compute_gap_oid) before posting.

    Parameters
    ----------
    base_url:
        The gateway base URL, e.g. ``https://gateway.synoi.systems/v1/gap``.
        Trailing slashes are stripped.
    token:
        Bearer token for authentication (``synoi-sk-<48 hex chars>``).
    tenant_id:
        Owning tenant. Stored for reference; the token already scopes the
        tenant on the server side.
    timeout:
        Request timeout in seconds (default 10.0).
    """

    def __init__(
        self,
        base_url: str,
        token: str,
        tenant_id: str,
        timeout: float = 10.0,
    ) -> None:
        if not _HAS_HTTPX:
            raise ImportError(
                "httpx is required for GapClient. "
                "Install it with: pip install synoi-gap[http]"
            )
        self._base = base_url.rstrip("/")
        self._headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }
        self.tenant_id = tenant_id
        self._timeout = timeout
        self._client: Optional["httpx.AsyncClient"] = None

    async def __aenter__(self) -> "GapClient":
        self._client = httpx.AsyncClient(
            headers=self._headers,
            timeout=self._timeout,
        )
        return self

    async def __aexit__(self, *_: Any) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    def _require_client(self) -> "httpx.AsyncClient":
        if self._client is None:
            raise RuntimeError(
                "GapClient must be used as an async context manager "
                "(async with GapClient(...) as client:)"
            )
        return self._client

    async def _post(self, path: str, body: dict) -> dict:
        client = self._require_client()
        r = await client.post(f"{self._base}{path}", json=body)
        r.raise_for_status()
        return r.json()

    async def _get(self, path: str, params: Optional[dict] = None) -> dict:
        client = self._require_client()
        r = await client.get(f"{self._base}{path}", params=params or {})
        r.raise_for_status()
        return r.json()

    # -- Declarations ----------------------------------------------------------

    async def post_declaration(self, envelope: dict) -> dict:
        """POST /declarations -- register a capability declaration."""
        return await self._post("/declarations", envelope)

    async def get_declaration(self, oid: str) -> dict:
        """GET /declarations/{oid} -- fetch a declaration by OID."""
        return await self._get(f"/declarations/{oid}")

    # -- Grants ----------------------------------------------------------------

    async def post_grant(self, envelope: dict) -> dict:
        """POST /grants -- issue a capability grant."""
        return await self._post("/grants", envelope)

    async def get_grant(self, oid: str) -> dict:
        """GET /grants/{oid} -- fetch a grant by OID."""
        return await self._get(f"/grants/{oid}")

    async def list_grants(
        self,
        actor_oid: Optional[str] = None,
        capability: Optional[str] = None,
        status: Optional[str] = None,
    ) -> dict:
        """GET /grants -- list grants with optional filters."""
        params = {
            k: v for k, v in {
                "actor_oid": actor_oid,
                "capability": capability,
                "status": status,
            }.items() if v is not None
        }
        return await self._get("/grants", params)

    # -- Invocations -----------------------------------------------------------

    async def invoke(self, envelope: dict) -> dict:
        """POST /invocations -- submit a capability invocation and receive a receipt."""
        return await self._post("/invocations", envelope)

    # -- Receipts --------------------------------------------------------------

    async def list_receipts(
        self,
        actor_oid: Optional[str] = None,
        grant_oid: Optional[str] = None,
        capability: Optional[str] = None,
        from_ms: Optional[int] = None,
        to_ms: Optional[int] = None,
        limit: int = 50,
        cursor: Optional[str] = None,
    ) -> dict:
        """GET /receipts -- list decision receipts with optional filters."""
        params: dict = {"limit": limit}
        if actor_oid is not None:
            params["actor_oid"] = actor_oid
        if grant_oid is not None:
            params["grant_oid"] = grant_oid
        if capability is not None:
            params["capability"] = capability
        if from_ms is not None:
            params["from_ms"] = from_ms
        if to_ms is not None:
            params["to_ms"] = to_ms
        if cursor is not None:
            params["cursor"] = cursor
        return await self._get("/receipts", params)

    async def get_receipt(self, oid: str) -> dict:
        """GET /receipts/{oid} -- fetch a receipt by OID."""
        return await self._get(f"/receipts/{oid}")

    # -- Revocation ------------------------------------------------------------

    async def revoke(self, envelope: dict) -> dict:
        """POST /revoke -- submit a revocation event."""
        return await self._post("/revoke", envelope)

    async def provisional_block(self, envelope: dict) -> dict:
        """POST /revoke/provisional-block -- apply a provisional block."""
        return await self._post("/revoke/provisional-block", envelope)

    async def revoke_approve(
        self,
        revocation_event_oid: str,
        approver_actor_oid: str,
        attestation_oid: Optional[str] = None,
    ) -> dict:
        """POST /revoke/approve -- approve a pending revocation event."""
        body: dict = {
            "revocation_event_oid": revocation_event_oid,
            "approver_actor_oid": approver_actor_oid,
        }
        if attestation_oid is not None:
            body["attestation_oid"] = attestation_oid
        return await self._post("/revoke/approve", body)

    async def get_revocation(self, oid: str) -> dict:
        """GET /revocations/{oid} -- fetch a revocation event by OID."""
        return await self._get(f"/revocations/{oid}")

    # -- Workflows -------------------------------------------------------------

    async def signal_workflow(
        self,
        workflow_instance_oid: str,
        channel: str,
        kind: str,
        payload: str,
        from_actor_oid: str,
    ) -> dict:
        """POST /workflows/signal -- deliver a signal to a running workflow instance.

        Parameters
        ----------
        workflow_instance_oid:
            OID of the workflow instance to signal.
        channel:
            Channel kind (e.g. "sms", "slack", "webhook").
        kind:
            Event kind string (matches the listen spec's event_kind or intent).
        payload:
            Event body string (the raw channel message text or webhook body).
        from_actor_oid:
            Sender identity string (E.164 for SMS; identity string for webhooks).
            Required per PC-02 sender-identity binding. The gateway verifies this
            against the registered sender for the channel; signals from unregistered
            senders are silently dropped and the stage timer continues.
        """
        return await self._post("/workflows/signal", {
            "workflow_instance_oid": workflow_instance_oid,
            "channel": channel,
            "event": {
                "kind": kind,
                "body": payload,
                "from": from_actor_oid,
            },
        })

    async def get_workflow_instance(self, oid: str) -> dict:
        """GET /workflows/instances/{oid} -- fetch a workflow instance by OID."""
        return await self._get(f"/workflows/instances/{oid}")

    # -- Keys ------------------------------------------------------------------

    async def get_current_key(self) -> dict:
        """GET /keys/current -- retrieve the gateway's current signing public key."""
        return await self._get("/keys/current")

    async def get_key_by_id(self, key_id: str) -> dict:
        """GET /keys/{key_id} -- fetch a historical signing key by ID.

        Old keys remain valid for verifying receipts signed under them.
        """
        return await self._get(f"/keys/{key_id}")
