# GAP Error Code Registry

Error codes appear in `GapDecisionReceipt.detail` and in HTTP error response bodies.
Format: `<category>:<specific_code>`.

Two delivery surfaces carry these codes:

- **Denial receipt (HTTP 200):** the gate ran, reached a deny decision, and emitted a `gap:decision_receipt` with `status` in (`denied`, `revoked`, `rate_limited`, `timed_out`). The code is in `receipt.body.detail`. The HTTP envelope still returns the receipt; the outcome-to-HTTP mapping in `IMPLEMENTING.md` Section 6 maps `denied` to 403, `revoked` to 410, `rate_limited` to 429. The "HTTP status" column below records that mapped invocation status. The denial is recorded regardless of HTTP code.
- **Error response (HTTP 4xx/5xx):** the request was rejected before (or instead of) a gate decision. The code is in `error.type` plus `error.message`, per the error shape in `IMPLEMENTING.md` Section 10.

The "Tier" column names the lowest conformance tier that MUST enforce the check. A check marked L2 is not guaranteed at L1 (the canonical example is `scope_narrowing`, which is grant-evaluation step 4 and is silently skipped at L1).

---

## capability_denied

Returned as a denial receipt unless a timestamp or idempotency precondition fails before the gate runs.

| Code | Meaning | HTTP status | Tier |
|---|---|---|---|
| `capability_denied:no_grant` | No matching grant found for this actor + capability | 403 (denial receipt) | L1 |
| `capability_denied:grant_actor_mismatch` | The grant named in `caller.grant_oid` exists but `grantee.actor_oid` does not match `caller.actor_oid`; grant poaching attempt | 403 (denial receipt) | L1 |
| `capability_denied:grant_expired` | Matching grant exists but `expires_at_ms` is in the past | 403 (denial receipt) | L1 |
| `capability_denied:grant_revoked` | Grant has a `gap:revocation_event` targeting it | 410 (denial receipt) | L1 |
| `capability_denied:declaration_revoked` | The capability declaration backing the grant has been revoked | 410 (denial receipt) | L1 |
| `capability_denied:scope_key_absent` | A `scope_narrowing` key is present in the grant but absent from invocation args; `detail` names the key | 403 (denial receipt) | L2 |
| `capability_denied:scope_value_mismatch` | Invocation args value does not satisfy a `scope_narrowing` constraint; `detail` names the key and constraint | 403 (denial receipt) | L2 |
| `capability_denied:scope_unevaluable` | A `scope_narrowing` value is an unrecognized type (null, mixed array); gateway denies rather than guess | 403 (denial receipt) | L2 |
| `capability_denied:precondition_failed` | A declaration `preconditions` or grant `additional_preconditions` predicate returned false | 403 (denial receipt) | L2 |
| `capability_denied:rate_limited` | `limits.max_invocations_per_minute` or `max_invocations_total` exceeded | 429 (denial receipt) | L2 |
| `capability_denied:aggregate_limit_exceeded` | A rolling-window `aggregate_limits` ceiling would be crossed; `detail` names the aggregated key | 429 (denial receipt) | L2 |
| `capability_denied:payload_too_large` | Invocation payload exceeds the grant or declaration `max_payload_bytes` | 403 (denial receipt) | L2 |
| `capability_denied:delegation_depth_exceeded` | `max_delegation_depth` exceeded along the grant chain (hard cap 10) | 403 (denial receipt) | L2 |
| `capability_denied:parent_grant_expired` | A parent grant in the delegation chain has expired | 403 (denial receipt) | L2 |
| `capability_denied:parent_grant_revoked` | A parent grant in the delegation chain has been revoked | 410 (denial receipt) | L2 |
| `capability_denied:parent_scope_violation` | Child invocation falls outside the parent grant's scope subset | 403 (denial receipt) | L2 |
| `capability_denied:ambiguous_grant` | Grant evaluation could not resolve a single applicable grant and deny-by-default applied | 403 (denial receipt) | L2 |
| `capability_denied:provisional_block_active` | Target is under an active 72-hour provisional block | 410 (denial receipt) | L4 |
| `capability_denied:future_timestamp` | Client-supplied `invoked_at_ms` is more than 5 minutes in the future | 400 | L1 |
| `capability_denied:past_timestamp` | Client-supplied `invoked_at_ms` is more than 60 seconds in the past | 400 | L1 |

Note on timestamp checks: for `physical_safety=true` or `safety_class='C'` capabilities the client MUST omit `invoked_at_ms`; a supplied value is stored only as `client_claimed_at_ms` and the timestamp checks do not gate the decision (the server always stamps `initiated_at_ms`). For all other capabilities the future/past bounds above apply.

---

## grant_rejected

Returned as an HTTP error from `POST /v1/gap/grants` and `POST /v1/gap/grants/:oid/update`. The grant is never stored.

| Code | Meaning | HTTP status | Tier |
|---|---|---|---|
| `grant_rejected:granted_by_mismatch` | `body.granted_by` does not match the Bearer token's operator OID | 403 | L1 |
| `grant_rejected:not_operator_role` | The caller is not an operator-role actor; grant issuance is operator-only | 403 | L1 |
| `grant_rejected:grantee_declaration_not_found` | The grantee `actor_oid` has no retrievable declaration | 404 | L1 |
| `grant_rejected:capability_not_declared` | A `capability_scopes[].capability` is not in the grantee's declaration | 400 | L2 |
| `grant_rejected:pin_required` | A `safety_class='C'` or `physical_safety` scope lacks the required `capability_declaration_oid` pin | 400 | L2 |
| `grant_rejected:missing_min_sibling` | A physical-safety numeric `scope_narrowing` key lacks its required `min_*` sibling | 400 | L2 |
| `grant_rejected:parent_grant_not_found` | `parent_grant_oid` references a grant that does not exist for this tenant | 404 | L2 |
| `grant_rejected:parent_grant_expired` | The referenced parent grant has expired at acceptance time | 400 | L2 |
| `grant_rejected:parent_grant_revoked` | The referenced parent grant has been revoked at acceptance time | 400 | L2 |
| `grant_rejected:scope_not_subset` | Child `capability_scopes` are not a subset of the parent grant's scopes | 400 | L2 |
| `grant_rejected:scope_widens_parent` | A child `scope_narrowing` value widens a parent constraint (drops a key, raises an upper bound, lowers a `min_*`, adds an out-of-set array element) | 400 | L2 |
| `grant_rejected:delegation_not_permitted` | Parent grant `max_delegation_depth` is 0 (or treated as 0 for physical safety) | 403 | L2 |
| `grant_rejected:delegation_depth_over_cap` | Requested `max_delegation_depth` exceeds the hard cap of 10 | 400 | L2 |
| `grant_rejected:expires_before_granted` | `expires_at_ms` is non-null and earlier than `granted_at_ms` | 400 | L1 |

---

## declaration_rejected

Returned as an HTTP error from `POST /v1/gap/declarations`. The declaration is never stored.

| Code | Meaning | HTTP status | Tier |
|---|---|---|---|
| `declaration_rejected:oid_mismatch` | The submitted `created_by` self-OID does not recompute to the canonical OID of the payload | 400 | L1 |
| `declaration_rejected:missing_required_field` | A required body field (`actor_type`, `actor_id`, `actor_name`, `actor_version`, `capabilities`) is absent | 400 | L1 |
| `declaration_rejected:invalid_actor_type` | `actor_type` is not in the actor taxonomy | 400 | L1 |
| `declaration_rejected:invalid_safety_class` | A capability `safety_class` is not one of A, B, C | 400 | L1 |
| `declaration_rejected:invalid_capability_name` | A capability name is empty or violates the dotted-taxonomy form | 400 | L1 |
| `declaration_rejected:supersedes_not_found` | `supersedes` references a declaration that does not exist for this tenant | 404 | L1 |
| `declaration_rejected:supersedes_actor_mismatch` | `supersedes` points to a declaration owned by a different actor | 403 | L1 |

---

## workflow_rejected

Returned as an HTTP error from `POST /v1/gap/workflows/definitions`, `POST /v1/gap/workflows/start`, and `POST /v1/gap/workflows/signal`. Workflow endpoints exist at L3 and above.

| Code | Meaning | HTTP status | Tier |
|---|---|---|---|
| `workflow_rejected:unsafe_timeout_path` | A physical-safety or class C definition has an `on_timeout` path reaching `terminal_outcome='approved'` (PC-11) | 400 | L3 |
| `workflow_rejected:operator_approval_required` | A physical-safety `capability_pattern` definition lacks `requires_operator_approval=true` or the signed operator attestation | 403 | L3 |
| `workflow_rejected:authorized_approvers_required` | A physical-safety or class C stage omits `authorized_approvers` | 400 | L3 |
| `workflow_rejected:from_binding_required` | A physical-safety or class C stage `listen` omits `required_from_binding` | 400 | L3 |
| `workflow_rejected:initial_stage_not_found` | `initial_stage_id` does not match any `stages[].stage_id` | 400 | L3 |
| `workflow_rejected:unknown_stage_reference` | A transition target (`next_stage_id`, `on_timeout`, `on_action_failure`) names a stage that does not exist | 400 | L3 |
| `workflow_rejected:channel_not_available` | A `required_channels` entry has no registered adapter | 400 | L3 |
| `workflow_rejected:definition_not_found` | `workflow_definition_oid` on start does not exist for this tenant | 404 | L3 |
| `workflow_rejected:template_variable_unresolved` | A `{{variable}}` reference could not be resolved at stage execution; the stage aborts to `on_action_failure` | 400 (in receipt: stage transition) | L3 |
| `workflow_rejected:instance_not_found` | `workflow_instance_oid` on signal does not exist for this tenant | 404 | L3 |
| `workflow_rejected:signal_sender_unregistered` | The signal `event.from` does not match the registered sender identity; signal silently dropped, stage timer continues | 200 (no advance) | L3 |
| `workflow_rejected:signal_from_binding_mismatch` | A physical-safety or class C stage signal `from` does not match `required_from_binding`; dropped | 200 (no advance) | L3 |
| `workflow_rejected:approver_not_authorized` | A YES signal's authenticated identity is not in the stage `authorized_approvers`; dropped | 200 (no advance) | L3 |
| `workflow_rejected:duplicate_stage_approval` | The same `actor_oid` attempts to satisfy a multi-approver stage twice | 200 (no advance) | L3 |

---

## revocation_rejected

Returned as an HTTP error from the `/v1/gap/revoke*` family. L1 revoke is mandatory at L1; leveled and provisional paths are L3/L4.

| Code | Meaning | HTTP status | Tier |
|---|---|---|---|
| `revocation_rejected:target_not_found` | `target_oid` does not exist for this tenant | 404 | L1 |
| `revocation_rejected:invalid_target_kind` | `target_kind` is not in the revocation target taxonomy | 400 | L1 |
| `revocation_rejected:invalid_level` | `required_level` does not match the endpoint (e.g. level 2 sent to `/revoke`) | 400 | L1 |
| `revocation_rejected:not_operator_role` | The caller is not an operator-role actor | 403 | L1 |
| `revocation_rejected:event_not_found` | `revocation_event_oid` on approve does not exist for this tenant | 404 | L3 |
| `revocation_rejected:duplicate_approver` | An approver `actor_oid` already appears on the event | 403 | L3 |
| `revocation_rejected:self_approval` | The approver OID equals the revocation event's `created_by` | 403 | L3 |
| `revocation_rejected:quorum_already_met` | The event already reached quorum and `effective_at_ms` is set | 409 | L3 |
| `revocation_rejected:provisional_policy_invalid` | A physical-safety or class C provisional block sets `on_expiry_without_quorum='revert'` | 400 | L4 |
| `revocation_rejected:missing_provisional_fields` | A provisional block omits `provisional=true`, `required_level`, or `approvers` | 400 | L4 |

---

## idempotency_*

Idempotency applies to `POST /v1/gap/invocations`. Keys are scoped per tenant for 24 hours.

| Code | Meaning | HTTP status | Tier |
|---|---|---|---|
| `idempotency_replay` | A prior invocation with the same key exists; the original receipt is returned without re-execution. The receipt has `is_idempotency_replay=true` and the `idempotency_replay` compliance tag. This is a success path, not an error | 200 | L1 |
| `idempotency_key_conflict` | The same key was reused with a different request body | 409 | L1 |
| `idempotency_key_too_long` | The supplied key exceeds the gateway's maximum key length | 400 | L1 |

---

## tenant_isolation_*

Every endpoint enforces tenant scope. Cross-tenant existence is never confirmed, so these surface as 404 (read) or 401 (auth), never as a 403 that would reveal another tenant's data.

| Code | Meaning | HTTP status | Tier |
|---|---|---|---|
| `tenant_isolation:object_cross_tenant` | The requested OID exists but belongs to another tenant; treated as not found | 404 | L1 |
| `tenant_isolation:token_unrecognized` | The Bearer token does not resolve to a known tenant | 401 | L1 |
| `tenant_isolation:operator_oid_unbound` | The token has no operator OID bound, but the operation requires one (grant or revocation issuance) | 403 | L1 |
| `tenant_isolation:created_by_foreign_tenant` | A submitted CDRO `created_by` resolves to an actor outside the authenticated tenant | 403 | L1 |

---

## validation_*

Request-shape validation that applies across all write endpoints, evaluated before any business rule.

| Code | Meaning | HTTP status | Tier |
|---|---|---|---|
| `validation:malformed_json` | The request body is not valid JSON | 400 | L1 |
| `validation:missing_body` | A write endpoint received no body | 400 | L1 |
| `validation:unsupported_gap_version` | A submitted CDRO declares a `gap_version` other than "1.0" | 400 | L1 |
| `validation:invalid_oid_format` | An OID path or field is not `sha256:<64 hex chars>` | 400 | L1 |
| `validation:oid_recomputation_failed` | A submitted CDRO's `oid` does not match the recomputed canonical hash | 400 | L1 |
| `validation:created_at_too_future` | `created_at_ms` is more than 5 minutes in the future (replay guard) | 400 | L1 |
| `validation:created_at_non_monotonic` | `created_at_ms` is earlier than the tenant's last recorded timestamp where monotonicity is enforced | 400 | L1 |
| `validation:unknown_object_type` | A submitted CDRO `type` is not a recognized `gap:*` type | 400 | L1 |
| `validation:unknown_query_param` | A list endpoint received an unrecognized query parameter | 400 | L2 |
| `validation:invalid_status_filter` | A `status` query value is outside the allowed enum | 400 | L2 |
| `validation:invalid_cursor` | The pagination `cursor` is malformed or expired | 400 | L1 |
| `validation:limit_out_of_range` | A `limit` query value is below 1 or above the gateway maximum | 400 | L1 |

---

## Mapping to the HTTP error envelope

The wire `error.type` enum in `IMPLEMENTING.md` Section 10 is intentionally coarse. Each registry category maps to one `error.type`, with the fine-grained registry code carried in `error.message`:

| Registry category | `error.type` |
|---|---|
| `capability_denied:*` (as HTTP error) | `capability_denied` |
| `grant_rejected:*` | `invalid_request` (auth subset uses `auth_error`) |
| `declaration_rejected:*` | `invalid_request` |
| `workflow_rejected:*` | `invalid_request` (not-found subset uses `not_found`) |
| `revocation_rejected:*` | `invalid_request` (not-found subset uses `not_found`) |
| `idempotency_key_conflict` | `invalid_request` |
| `tenant_isolation:*` | `not_found` (read) or `auth_error` (token/operator) |
| `validation:*` | `invalid_request` |
| any unhandled server fault | `internal_error` |

When a code is delivered in a denial receipt rather than an HTTP error, it appears verbatim in `GapDecisionReceipt.body.detail` (for example `capability_denied:scope_key_absent`), and the HTTP envelope returns the receipt with the mapped invocation status.
