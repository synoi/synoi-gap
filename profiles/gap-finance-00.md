# GAP Companion Profile: Financial Services

**Draft:** gap-finance-00.md
**Base spec:** draft-shovan-gap-00 or later
**Namespace:** `fin.*`
**Status:** Draft
**Authors:** Open for community contribution

---

## 1. Overview

This profile extends the Governed Action Protocol for AI agents operating in trading, banking,
payments, and compliance workflows. It registers the `fin.*` capability namespace, three normative
precondition kinds (`pre_trade_compliance`, `algo_circuit_breaker`, `transfer_velocity`), and
three CDRO types for trade audit chains, circuit-breaker events, and compliance assertions.

Financial services operators adopting this profile get:

- Every class C order, transfer, and compliance filing bound to a signed, immutable receipt that
  supports audit obligations under Regulation Best Interest (Reg BI), MiFID II, and Dodd-Frank.
  Informative references to those frameworks appear throughout this document; this profile does not
  constitute legal advice and does not claim to satisfy any specific regulatory requirement on its own.
- Pre-trade compliance checks cryptographically bound to the grant chain, so the compliance PIP
  response that authorized an order is traceable to the specific invocation receipt.
- Algorithmic order flows governed by a post-settlement circuit breaker that suspends the grant
  and emits a signed event when daily loss or position concentration thresholds are crossed.
- Transfer velocity controls enforced server-side in real time, with a signed velocity record in
  the receipt for every denial.

**Privacy and MNPI handling.** Financial CDROs destined for shared or public receipt logs MUST NOT
contain raw ticker symbols, account numbers, routing numbers, or dollar amounts that could constitute
material non-public information (MNPI) or personally identifiable financial data. Operators MUST
replace such identifiers with HMAC-SHA256 values keyed by a tenant-scoped key (see Section 4).
Plaintext values MAY be stored in an operator-controlled, access-controlled settlement store that
is distinct from the public receipt log.

This profile composes freely with other profiles. A bank running both trading and supply-chain
workflows can activate `gap-finance-00` and `gap-supply-chain-00` simultaneously; the `fin.*`
namespace does not conflict with any other registered profile namespace.

---

## 2. Capability Taxonomy

Capability names use the `fin.` root. Sub-namespaces are open; operators may extend any branch
(e.g., `fin.order.equity.submit.dark_pool`) without profile amendment.

### 2.1 Safety class definitions for this profile

| Class | Definition in financial services context                                                   |
|-------|-------------------------------------------------------------------------------------------|
| A     | Read-only queries: market data, quotes, portfolio positions, account balances              |
| B     | Reversible or low-risk mutations: order cancellation, internal transfer, compliance flags  |
| C     | Irreversible, high-stakes, or regulated actions: order submission, external transfer, credit extension, regulatory filings |

### 2.2 Capability names

| Capability name                  | Class | require_signed_receipt | Notes                                                         |
|----------------------------------|-------|------------------------|---------------------------------------------------------------|
| `fin.market.quote.read`          | A     | false                  | Read spot or delayed market quotes                            |
| `fin.market.data.stream`         | A     | false                  | Subscribe to a live market data feed                          |
| `fin.portfolio.read`             | A     | false                  | Read portfolio positions and unrealized P&L                   |
| `fin.account.balance.read`       | A     | false                  | Read account cash balance and margin available                |
| `fin.order.preview`              | A     | false                  | Simulate an order without placing it (margin check, cost estimate) |
| `fin.transfer.internal`          | B     | false                  | Transfer between accounts owned by the same actor             |
| `fin.order.cancel`               | B     | false                  | Cancel a pending, open order                                  |
| `fin.compliance.flag.set`        | B     | false                  | Flag a transaction for manual compliance review               |
| `fin.order.equity.submit`        | C     | true                   | Submit an equity order to an exchange or dark pool            |
| `fin.order.options.submit`       | C     | true                   | Submit an options order                                       |
| `fin.order.algo.submit`          | C     | true                   | Submit a systematic or algorithmic order                      |
| `fin.transfer.external`          | C     | true                   | Initiate a wire or ACH transfer to an external account        |
| `fin.credit.extend`              | C     | true                   | Extend margin credit or approve a credit line                 |
| `fin.compliance.report.file`     | C     | true                   | File a regulatory report (SAR, CTR, MiFID transaction report) |

Operators MAY extend any prefix with additional capabilities without amending this profile.
Operators MUST NOT reuse a capability name defined above with different semantics.

---

## 3. Precondition Kind Registry

### 3.1 `pre_trade_compliance`

**Evaluation timing:** `pre_invoke`

**Purpose:** Gates class C trading capabilities on a current compliance PIP determination,
binding the PIP response to the grant chain before an order is placed.

**Args schema:**

```json
{
  "type": "object",
  "required": ["rule_set", "compliance_endpoint"],
  "properties": {
    "rule_set": {
      "type": "string",
      "description": "Identifier for the compliance rule set to evaluate. Examples: 'SEC_RegBI', 'MiFID2', 'FINRA_4511'. The gateway passes this value verbatim to the compliance PIP."
    },
    "compliance_endpoint": {
      "type": "string",
      "description": "URL of the compliance PIP. MUST be HTTPS. The gateway invokes this endpoint with the actor OID, capability name, and grant scope at evaluation time."
    },
    "max_order_value_usd": {
      "type": "number",
      "minimum": 0,
      "description": "Optional. If present, the gateway MUST deny any invocation where the capability args include an order_value_usd field exceeding this cap, without invoking the PIP."
    }
  }
}
```

**Normative evaluation (MUST):**

A gateway evaluating `pre_trade_compliance` MUST:

1. Check whether a valid `fin:compliance_assertion` CDRO exists in the tenant store for the
   tuple `(actor_oid, args.rule_set)` with `expires_at_ms > server_time_ms`. If a valid cached
   assertion exists, proceed to step 5.
2. Construct a PIP request containing at minimum: the actor OID, the capability name being
   invoked, the grant OID, and the full args payload of the invocation.
3. POST the PIP request to `args.compliance_endpoint` over HTTPS. If the endpoint is
   unreachable or returns a non-2xx response, deny the invocation with
   `precondition_failed`, `precondition_kind: "pre_trade_compliance"`, and
   `pip_error: "endpoint_unavailable"` in the receipt detail.
4. Parse the PIP response as a `fin:compliance_assertion` body (Section 4.3). Store the
   assertion CDRO in the tenant receipt store. Set `expires_at_ms` to
   `asserted_at_ms + 30000` (30 seconds).
5. Verify `assertion_result == "pass"`. If the result is `"fail"`, deny the invocation with
   `precondition_failed`, `precondition_kind: "pre_trade_compliance"`, and
   `rule_violations: [...]` populated from the assertion's `violations` array.
6. If `args.max_order_value_usd` is present and the invocation args contain `order_value_usd`,
   deny if `order_value_usd > args.max_order_value_usd` with
   `precondition_failed` and `pip_error: "order_value_cap_exceeded"`.
7. Record the `fin:compliance_assertion` OID as `compliance_pip_oid` in the subsequently
   issued `fin:trade_audit_record` CDRO.

**Cache behavior:** 30 seconds per `(actor_oid, rule_set, capability_name)`. The cache MUST be
invalidated immediately if a `fin.compliance.flag.set` invocation is received for the actor.

**Gateway requirement:** MUST evaluate server-side. The compliance PIP call MUST NOT be
delegated to the actor.

**Failure action:** `deny`.

---

### 3.2 `algo_circuit_breaker`

**Evaluation timing:** `post_invoke`

**Purpose:** After each algorithmic order settles, checks whether the actor has exceeded
daily loss or position concentration limits and suspends the grant if so, preventing
uncontrolled drawdown loops.

**Args schema:**

```json
{
  "type": "object",
  "required": ["max_daily_loss_usd", "max_position_pct"],
  "properties": {
    "max_daily_loss_usd": {
      "type": "number",
      "minimum": 0,
      "description": "Maximum realized and unrealized daily loss in USD before the grant is suspended."
    },
    "max_position_pct": {
      "type": "number",
      "minimum": 0,
      "maximum": 100,
      "description": "Maximum single-position concentration as a percentage of total portfolio value. Evaluated per symbol."
    },
    "lookback_minutes": {
      "type": "integer",
      "minimum": 1,
      "default": 60,
      "description": "Rolling window in minutes over which daily loss is computed. Defaults to 60."
    }
  }
}
```

**Normative evaluation (MUST):**

A gateway evaluating `algo_circuit_breaker` MUST:

1. After a `fin.order.algo.submit` invocation produces an allowed receipt, retrieve the actor's
   current P&L summary and per-symbol position concentrations from the operator's settlement
   store. The gateway MUST treat a retrieval failure as a trigger condition (fail-safe): if the
   settlement store is unreachable, apply `provisional_block` immediately.
2. Compute rolling daily loss over the preceding `args.lookback_minutes` window by summing all
   `fin:trade_audit_record` CDROs for the actor OID with `submitted_at_ms` within the window,
   adding unrealized P&L from the settlement store.
3. Compute per-symbol position as `(position_market_value / total_portfolio_value) * 100`.
4. If `daily_loss_usd >= args.max_daily_loss_usd`, apply `provisional_block` on the grant.
5. If any per-symbol `position_pct >= args.max_position_pct`, apply `provisional_block` on
   the grant.
6. On any `provisional_block` trigger, emit a `fin:circuit_breaker_event` CDRO (Section 4.2)
   referencing the `fin:trade_audit_record` OID of the triggering order.
7. Notify the operator's configured alert channel (if any) synchronously before returning the
   receipt. Notification failure MUST NOT prevent the `provisional_block` from being applied.

The grant remains in `provisional_block` state until an authorized human operator or a
separate grant with `fin.order.cancel` authority issues a resume action. The gateway MUST
record the resume as an update to the `fin:circuit_breaker_event` CDRO by populating
`resumed_at_ms`.

**Cache behavior:** No caching. The settlement store MUST be queried after every
`fin.order.algo.submit` invocation.

**Gateway requirement:** MUST evaluate server-side.

**Failure action:** `provisional_block`.

---

### 3.3 `transfer_velocity`

**Evaluation timing:** `pre_invoke`

**Purpose:** Gates `fin.transfer.external` on per-transfer and rolling daily transfer caps,
preventing an agent from draining accounts through rapid successive transfers.

**Args schema:**

```json
{
  "type": "object",
  "required": ["max_per_transfer_usd", "max_daily_usd"],
  "properties": {
    "max_per_transfer_usd": {
      "type": "number",
      "minimum": 0,
      "description": "Maximum USD value of a single external transfer."
    },
    "max_daily_usd": {
      "type": "number",
      "minimum": 0,
      "description": "Maximum total USD of all fin.transfer.external receipts for the actor within the rolling window."
    },
    "window_hours": {
      "type": "integer",
      "minimum": 1,
      "default": 24,
      "description": "Rolling window in hours over which the daily cap is computed. Defaults to 24."
    }
  }
}
```

**Normative evaluation (MUST):**

A gateway evaluating `transfer_velocity` MUST:

1. Extract `transfer_value_usd` from the invocation args. If the field is absent or cannot be
   parsed as a positive number, deny with `precondition_failed` and
   `pip_error: "missing_transfer_value"`.
2. If `transfer_value_usd > args.max_per_transfer_usd`, deny with `precondition_failed`,
   `precondition_kind: "transfer_velocity"`, and
   `velocity_detail: {"reason": "per_transfer_cap_exceeded", "limit": ..., "requested": ...}`.
3. Sum the `transfer_value_usd` field of all `fin:trade_audit_record` CDROs for the actor OID
   with `type == "fin:trade_audit_record"`, `order_type == "external_transfer"`, and
   `submitted_at_ms >= (server_time_ms - (args.window_hours * 3600000))`.
4. If `rolling_sum + transfer_value_usd > args.max_daily_usd`, deny with
   `precondition_failed`, `precondition_kind: "transfer_velocity"`, and
   `velocity_detail: {"reason": "daily_cap_exceeded", "limit": ..., "rolling_sum": ..., "requested": ...}`.
5. Allow the invocation. The gateway records the resulting receipt; the settlement amount is
   counted in subsequent velocity checks for this actor.

**Cache behavior:** No caching. The rolling sum MUST be computed in real time from the receipt
store on every invocation.

**Gateway requirement:** MUST evaluate server-side.

**Failure action:** `deny`.

---

## 4. CDRO Type Registry

### 4.1 `fin:trade_audit_record`

**Purpose:** Records every class C order or transfer action in a signed, chained audit record
designed to support audit obligations under Reg BI, MiFID II, Dodd-Frank, and equivalent
frameworks. Each record links to its predecessor in the per-actor, per-symbol receipt chain.

**Status:** Stable

**Signing requirement:** MUST be signed at gateway level L2 or higher.

**Privacy requirement:** Operators MUST NOT store raw ticker symbols, account numbers, routing
numbers, or counterparty identifiers in the `symbol_hash` field or any other field of this
CDRO when the record is written to a shared or public receipt log. The `symbol_hash` and
`account_hash` fields MUST be HMAC-SHA256 values computed with a key derived from `tenant_id`.
The pre-image MAY be stored in the operator's access-controlled settlement store.

**Body schema:**

| Field                  | Type    | Required | Description                                                                                  |
|------------------------|---------|----------|----------------------------------------------------------------------------------------------|
| `actor_oid`            | string  | yes      | OID of the actor who submitted the order                                                     |
| `grant_oid`            | string  | yes      | OID of the grant that authorized the invocation                                              |
| `prior_receipt_oid`    | string  | no       | OID of the previous `fin:trade_audit_record` for the same `(actor_oid, symbol_hash)` pair; null for the first trade |
| `order_type`           | string  | yes      | One of: `equity`, `options`, `algo`, `external_transfer`                                     |
| `symbol_hash`          | string  | yes      | `hmac-sha256:<hex>` of the ticker symbol or instrument identifier, keyed by tenant-scoped key |
| `account_hash`         | string  | yes      | `hmac-sha256:<hex>` of the source account identifier, keyed by tenant-scoped key             |
| `quantity`             | number  | yes      | Number of shares, contracts, or units                                                        |
| `side`                 | string  | yes      | `buy`, `sell`, `debit`, or `credit`                                                          |
| `order_value_usd`      | number  | yes      | Notional USD value of the order at submission time                                           |
| `exchange`             | string  | no       | Exchange or venue identifier (e.g., `NYSE`, `CBOE`, `SWIFT`); MAY be omitted if sensitive    |
| `compliance_pip_oid`   | string  | no       | OID of the `fin:compliance_assertion` CDRO that authorized this order; required for class C trading capabilities |
| `submitted_at_ms`      | integer | yes      | Milliseconds since epoch when the order was submitted to the venue                           |
| `settlement_status`    | string  | yes      | `pending`, `settled`, or `rejected`; this field is mutable and excluded from OID computation |

**OID computation:** `sha256(canonical({actor_oid, grant_oid, prior_receipt_oid, order_type,
symbol_hash, account_hash, quantity, side, order_value_usd, exchange, compliance_pip_oid,
submitted_at_ms}))`. The `settlement_status` field is excluded because it may be updated
after initial issuance.

**Chain requirements:** MUST reference `prior_receipt_oid` of the previous
`fin:trade_audit_record` for the same `(actor_oid, symbol_hash)` pair in the tenant store, or
set `prior_receipt_oid` to null if no prior record exists. This forms a per-actor, per-symbol
hash chain that enables auditability of the full trading history without exposing the pre-image
of `symbol_hash` in the chain linkage.

---

### 4.2 `fin:circuit_breaker_event`

**Purpose:** Records the suspension of an algorithmic trading grant when the `algo_circuit_breaker`
precondition determines that daily loss or position concentration thresholds have been crossed.
Provides a signed, content-addressed record for post-incident review and regulatory inquiry.

**Status:** Stable

**Signing requirement:** MUST be signed.

**Body schema:**

| Field               | Type    | Required | Description                                                                       |
|---------------------|---------|----------|-----------------------------------------------------------------------------------|
| `actor_oid`         | string  | yes      | OID of the actor whose grant was suspended                                        |
| `grant_oid`         | string  | yes      | OID of the suspended grant                                                        |
| `triggering_record_oid` | string | yes   | OID of the `fin:trade_audit_record` CDRO whose settlement caused the trigger      |
| `trigger_reason`    | string  | yes      | `max_daily_loss` or `max_position_pct`                                            |
| `measured_value`    | number  | yes      | The measured value at the time of trigger (USD loss or position percentage)       |
| `threshold`         | number  | yes      | The configured threshold that was crossed                                         |
| `lookback_minutes`  | integer | yes      | The lookback window in effect at the time of trigger                              |
| `triggered_at_ms`   | integer | yes      | Milliseconds since epoch when the suspension was applied                          |
| `resumed_at_ms`     | integer | no       | Milliseconds since epoch when the grant was resumed by an authorized operator; null until resumed |

**OID computation:** `sha256(canonical({actor_oid, grant_oid, triggering_record_oid,
trigger_reason, measured_value, threshold, lookback_minutes, triggered_at_ms}))`. The
`resumed_at_ms` field is excluded and updated in the gateway's receipt store when a resume
action is recorded.

**Chain requirements:** MUST reference `triggering_record_oid`, which MUST resolve to a
`fin:trade_audit_record` CDRO in the tenant store. This forms an evidence chain from the
specific order that crossed the threshold to the suspension event.

---

### 4.3 `fin:compliance_assertion`

**Purpose:** Records a compliance PIP determination (pass or fail) for a specific actor, rule
set, and invocation context. Cached and chained so that every class C order receipt can
reference the compliance authorization that preceded it.

**Status:** Stable

**Signing requirement:** SHOULD be signed. Operators MUST sign when `assertion_result == "pass"`
and the assertion will be used as `compliance_pip_oid` in a `fin:trade_audit_record`.

**Body schema:**

| Field                | Type           | Required | Description                                                                            |
|----------------------|----------------|----------|----------------------------------------------------------------------------------------|
| `actor_oid`          | string         | yes      | OID of the actor the assertion covers                                                  |
| `rule_set`           | string         | yes      | Rule set identifier (e.g., `SEC_RegBI`, `MiFID2`)                                     |
| `assertion_result`   | string         | yes      | `pass` or `fail`                                                                       |
| `violations`         | array(string)  | yes      | List of rule violation identifiers; empty array on pass                                |
| `pip_endpoint_hash`  | string         | yes      | `hmac-sha256:<hex>` of the compliance PIP endpoint URL, keyed by tenant-scoped key; avoids exposing internal PIP URLs in shared logs |
| `asserted_at_ms`     | integer        | yes      | Milliseconds since epoch when the PIP response was received                            |
| `expires_at_ms`      | integer        | yes      | Milliseconds since epoch when this assertion expires (typically `asserted_at_ms + 30000`) |
| `pip_signature`      | string         | no       | Optional signature from the compliance PIP over its native response payload, base64url  |

**OID computation:** `sha256(canonical({actor_oid, rule_set, assertion_result, violations,
pip_endpoint_hash, asserted_at_ms, expires_at_ms}))`. The `pip_signature` field is excluded
from the gateway's canonical payload to avoid double-encoding the PIP's native format.

**Chain requirements:** None on `fin:compliance_assertion` itself. The `fin:trade_audit_record`
that references this assertion MUST set `compliance_pip_oid` to this CDRO's OID.

---

## 5. Conformance Requirements

A gateway claiming `gap-finance-00` profile support MUST:

1. Evaluate the `pre_trade_compliance` precondition kind per Section 3.1 for any `fin.*` class C
   trading capability where the precondition appears in the grant.
2. Evaluate the `algo_circuit_breaker` precondition kind per Section 3.2 for any
   `fin.order.algo.submit` invocation where the precondition appears in the grant.
3. Evaluate the `transfer_velocity` precondition kind per Section 3.3 for any
   `fin.transfer.external` invocation where the precondition appears in the grant.
4. Issue `fin:trade_audit_record` CDROs for every class C `fin.*` invocation that results in
   an allowed receipt (Section 4.1).
5. Emit `fin:circuit_breaker_event` CDROs when `algo_circuit_breaker` suspends a grant
   (Section 4.2).
6. Store `fin:compliance_assertion` CDROs received from compliance PIPs (Section 4.3).
7. Enforce the MNPI privacy requirement: MUST NOT store raw ticker symbols, account numbers,
   or routing numbers in CDRO bodies written to shared or public receipt logs (Section 1,
   Section 4.1).
8. Operate at gateway core tier L2 minimum for all `fin.*` capabilities.
9. Operate at gateway core tier L3 minimum (HITL workflow available) for
   `fin.transfer.external` and `fin.credit.extend` when invoked above a configurable HITL
   threshold that the operator sets in the grant.
10. Operate at gateway core tier L4 minimum for `fin.compliance.report.file` to support
    cross-institution receipt verification.

A gateway claiming `gap-finance-00` profile support SHOULD:

11. Expose a settlement store query interface that the `algo_circuit_breaker` precondition
    can call to retrieve real-time P&L and position data, distinct from the CDRO receipt store.
12. Implement grant resumption for `provisional_block` states via an authorized human operator
    action that updates the `fin:circuit_breaker_event` CDRO with `resumed_at_ms`.

Profile conformance is declared in the gateway discovery response:

```json
{
  "core_tier": "L2",
  "profiles": ["gap-finance-00"]
}
```

For operators requiring L3 or L4 features:

```json
{
  "core_tier": "L4",
  "profiles": ["gap-finance-00"]
}
```

### 5.1 Regulatory informative note

This profile is designed to support audit obligations under Regulation Best Interest (SEC Reg BI),
MiFID II transaction reporting, and Dodd-Frank recordkeeping requirements, among others. The
signed `fin:trade_audit_record` chain and `fin:compliance_assertion` linkage are designed to
produce an evidence record auditors can inspect. This profile does not itself constitute a
compliance system and does not make legal conclusions about regulatory conformance. Operators
are responsible for independent legal review of their compliance architecture.

---

## 6. Informative Examples

### 6.1 Declaration for an equity order agent with pre-trade compliance

```json
{
  "type": "gap:capability_declaration",
  "actor_id": "equity-trading-agent-a4b1",
  "actor_type": "agent",
  "actor_name": "Equity Order Agent",
  "actor_version": "1.0.0",
  "capabilities": [
    {
      "capability": "fin.order.equity.submit",
      "safety_class": "C",
      "require_signed_receipt": true,
      "preconditions": [
        {
          "kind": "pre_trade_compliance",
          "args": {
            "rule_set": "SEC_RegBI",
            "compliance_endpoint": "https://pip.internal.example.com/regbi",
            "max_order_value_usd": 250000
          }
        }
      ]
    },
    {
      "capability": "fin.market.quote.read",
      "safety_class": "A",
      "require_signed_receipt": false
    },
    {
      "capability": "fin.portfolio.read",
      "safety_class": "A",
      "require_signed_receipt": false
    }
  ]
}
```

### 6.2 Declaration for an algorithmic trading agent with circuit breaker

```json
{
  "type": "gap:capability_declaration",
  "actor_id": "algo-trading-agent-c7d3",
  "actor_type": "agent",
  "actor_name": "Algorithmic Trading Agent",
  "actor_version": "1.0.0",
  "capabilities": [
    {
      "capability": "fin.order.algo.submit",
      "safety_class": "C",
      "require_signed_receipt": true,
      "preconditions": [
        {
          "kind": "pre_trade_compliance",
          "args": {
            "rule_set": "MiFID2",
            "compliance_endpoint": "https://pip.internal.example.com/mifid2"
          }
        },
        {
          "kind": "algo_circuit_breaker",
          "args": {
            "max_daily_loss_usd": 50000,
            "max_position_pct": 15,
            "lookback_minutes": 60
          }
        }
      ]
    }
  ]
}
```

### 6.3 Declaration for an external transfer agent with velocity control

```json
{
  "type": "gap:capability_declaration",
  "actor_id": "transfer-agent-e9f5",
  "actor_type": "agent",
  "actor_name": "External Transfer Agent",
  "actor_version": "1.0.0",
  "capabilities": [
    {
      "capability": "fin.transfer.external",
      "safety_class": "C",
      "require_signed_receipt": true,
      "preconditions": [
        {
          "kind": "transfer_velocity",
          "args": {
            "max_per_transfer_usd": 10000,
            "max_daily_usd": 25000,
            "window_hours": 24
          }
        }
      ]
    }
  ]
}
```

### 6.4 `fin:trade_audit_record` CDRO for an equity order

```json
{
  "type": "fin:trade_audit_record",
  "actor_oid": "sha256:a4b1...",
  "grant_oid": "sha256:b2c8...",
  "prior_receipt_oid": "sha256:9d4e...",
  "order_type": "equity",
  "symbol_hash": "hmac-sha256:3f7a91c2...",
  "account_hash": "hmac-sha256:8b2d44f1...",
  "quantity": 500,
  "side": "buy",
  "order_value_usd": 187500.00,
  "exchange": "NYSE",
  "compliance_pip_oid": "sha256:1a2b3c...",
  "submitted_at_ms": 1750000000000,
  "settlement_status": "pending"
}
```

### 6.5 `fin:circuit_breaker_event` CDRO on algo suspension

```json
{
  "type": "fin:circuit_breaker_event",
  "actor_oid": "sha256:c7d3...",
  "grant_oid": "sha256:d4e9...",
  "triggering_record_oid": "sha256:f5a0...",
  "trigger_reason": "max_daily_loss",
  "measured_value": 51240.75,
  "threshold": 50000,
  "lookback_minutes": 60,
  "triggered_at_ms": 1750003600000,
  "resumed_at_ms": null
}
```

### 6.6 `fin:compliance_assertion` CDRO from a Reg BI PIP

```json
{
  "type": "fin:compliance_assertion",
  "actor_oid": "sha256:a4b1...",
  "rule_set": "SEC_RegBI",
  "assertion_result": "pass",
  "violations": [],
  "pip_endpoint_hash": "hmac-sha256:77c3a9b0...",
  "asserted_at_ms": 1750000000000,
  "expires_at_ms": 1750000030000
}
```

### 6.7 Receipt for an external transfer denial (velocity cap exceeded)

```json
{
  "oid": "sha256:<computed>",
  "type": "gap:decision_receipt",
  "gap_version": "1.0",
  "tenant_id": "my-tenant",
  "created_at_ms": 1750003610000,
  "created_by": "sha256:<gateway-actor-oid>",
  "body": {
    "subject_kind": "capability_invocation",
    "subject_oid": "sha256:g6h1...",
    "initiator": { "actor_oid": "sha256:e9f5...", "actor_type": "agent" },
    "status": "denied",
    "initiated_at_ms": 1750003610000,
    "resolved_at_ms": 1750003610005,
    "detail": "transfer_velocity: daily_cap_exceeded; limit=25000, rolling_sum=21500, requested=5000"
  }
}
```

---

## Appendix: Suggested capability taxonomy extensions

These names are not normative in this draft. Community implementers may stabilize them in a
future revision.

| Capability name                          | Class | Notes                                                      |
|------------------------------------------|-------|------------------------------------------------------------|
| `fin.order.futures.submit`               | C     | Futures contract order submission                          |
| `fin.order.fx.submit`                    | C     | Foreign exchange order                                     |
| `fin.order.bond.submit`                  | C     | Fixed-income order                                         |
| `fin.account.open`                       | C     | Open a new account (KYC-gated)                             |
| `fin.account.close`                      | C     | Close an account                                           |
| `fin.compliance.kyc.verify`              | B     | Trigger a KYC verification step for an actor               |
| `fin.compliance.aml.flag.set`            | B     | Flag an actor for AML review                               |
| `fin.transfer.internal.scheduled`        | B     | Schedule a recurring internal transfer                     |
| `fin.portfolio.rebalance.preview`        | A     | Preview a rebalancing plan without placing orders          |
| `fin.market.data.historical.read`        | A     | Read historical OHLCV data for a symbol                    |
