# GAP Use Cases: Environments and Cross-Environment Coordination

GAP is described as a governance protocol, but governance is the accountability layer on top of something more fundamental: a **universal action coordination fabric**. Any environment that can declare what it does, any operator who can express who is allowed to do what, and any actor who needs a signed record of what happened can speak GAP.

This document covers eight environments, what GAP looks like inside each one, and the cross-environment scenarios that are only possible because all of them share the same protocol.

---

## Contents

1. [Gaming and Interactive Media](#1-gaming-and-interactive-media)
2. [Smart Home and Consumer IoT](#2-smart-home-and-consumer-iot)
3. [Industrial Automation and OT](#3-industrial-automation-and-ot)
4. [Healthcare and Medical Devices](#4-healthcare-and-medical-devices)
5. [AI Agent Pipelines](#5-ai-agent-pipelines)
6. [Software Automation and Enterprise Integration](#6-software-automation-and-enterprise-integration)
7. [Physical Security and Access Control](#7-physical-security-and-access-control)
8. [Cross-Environment Scenarios](#8-cross-environment-scenarios)

---

## 1. Gaming and Interactive Media

### The problem

A game wants to make the physical world react to what happens in the virtual world. The player walks into a dark cave in the game: the lights in the room should dim. The player takes damage: the haptic controller should pulse. The player completes a mission: a real badge should appear on their phone.

Without a standard protocol, every game studio builds a custom integration with every smart device. A single studio connecting to lights, haptics, climate, and push notifications writes four integrations, each from scratch, each ungoverned: no audit trail, no revocation, no way to limit what the game can do.

GAP solves this with one integration surface.

### What the actor looks like

The game engine or a companion service registers as a `service` actor:

```json
{
  "actor_type": "service",
  "actor_id": "service:dark-realm-game-engine",
  "actor_name": "Dark Realm Game Engine",
  "actor_version": "2.1.0",
  "capabilities": [
    {
      "capability": "home.lighting.control",
      "safety_class": "B",
      "scope": { "rooms": ["any"], "max_brightness_delta": -50 }
    },
    {
      "capability": "device.haptic.pulse",
      "safety_class": "A"
    },
    {
      "capability": "messaging.push.send",
      "safety_class": "A",
      "scope": { "topics": ["game-achievements"] }
    }
  ],
  "human_summary": "Reacts the physical environment to in-game events."
}
```

### The grant

The player (operator) issues a grant scoping what the game is allowed to do:

```json
{
  "grantee": { "actor_oid": "sha256:<game-engine-oid>" },
  "capability_scopes": [
    {
      "capability": "home.lighting.control",
      "scope_narrowing": { "rooms": ["living-room"], "max_brightness_delta": -30 }
    },
    { "capability": "device.haptic.pulse" },
    {
      "capability": "messaging.push.send",
      "scope_narrowing": { "topics": ["game-achievements"] }
    }
  ],
  "expires_at_ms": null,
  "reason": "Player opted in via game settings on 2026-06-24"
}
```

The grant is scoped narrower than the declaration: only the living room, only 30% dimming maximum, only the game-achievements push topic. The player can revoke it any time: one API call, and every subsequent invocation from the game engine is denied.

### Invocation: lights dim on entering a dark room

```json
{
  "caller": { "actor_oid": "sha256:<game-engine-oid>", "grant_oid": "sha256:<grant-oid>" },
  "capability": "home.lighting.control",
  "args": {
    "rooms": "living-room",
    "action": "set_brightness",
    "level": 15,
    "transition_ms": 3000
  },
  "idempotency_key": "scene-dark-cave-entry-session-8821"
}
```

Note: `rooms` matches the scope_narrowing key on the grant (`"rooms": ["living-room"]`). The value `"living-room"` must be in the array.

### Invocation: haptic pulse on player damage

```json
{
  "caller": { "actor_oid": "sha256:<game-engine-oid>", "grant_oid": "sha256:<grant-oid>" },
  "capability": "device.haptic.pulse",
  "args": {
    "pattern": "short-sharp",
    "duration_ms": 200,
    "intensity": 0.8
  }
}
```

Standard `device.haptic.pulse` args: `pattern` (string: `"short-sharp"`, `"long-rumble"`, `"double-tap"`, `"slow-pulse"`), `duration_ms` (number, milliseconds), `intensity` (number, 0.0-1.0).

### Invocation: push notification on mission complete

```json
{
  "caller": { "actor_oid": "sha256:<game-engine-oid>", "grant_oid": "sha256:<grant-oid>" },
  "capability": "messaging.push.send",
  "args": {
    "topics": "game-achievements",
    "title": "Mission Complete",
    "body": "You completed The Dark Depths. +500 XP",
    "data": { "mission_id": "dark-depths", "xp": 500 }
  }
}
```

Note: `topics` matches the scope_narrowing key on the grant (`"topics": ["game-achievements"]`). Standard `messaging.push.send` args: `topics` (string, must match the grant's scope_narrowing topics array), `title` (string), `body` (string), `data` (object, optional metadata).

The receipt records that the game engine dimmed the living room at a specific timestamp. The player can audit it, the platform can aggregate it, and the capability reverts when the game session ends via an explicit revocation or grant expiry.

### What this enables

- **Cross-reality presence**: game state drives physical environment without custom integrations.
- **Player-controlled access**: the player grants and revokes at will, not the studio.
- **Audit for disputes**: "did the game turn off my lights at 2am?" is answerable from the receipt log.
- **Safety boundaries**: the grant prevents the game from turning off lights entirely (max_brightness_delta enforced), preventing safety hazards.

---

## 2. Smart Home and Consumer IoT

### The problem

A smart home has dozens of devices from different manufacturers. A voice assistant, an automation rule, a security system, and a phone app all need to control overlapping sets of devices. Today each integration is siloed. The security system has no idea the voice assistant just unlocked the front door. No one has an audit trail of who changed what when.

### Actors and capabilities

Each device type registers its own declaration:

```json
{ "actor_type": "device", "actor_id": "device:front-door-lock-001",
  "capabilities": [
    { "capability": "physical.lock.engage",   "safety_class": "C", "physical_safety": true },
    { "capability": "physical.lock.disengage","safety_class": "C", "physical_safety": true },
    { "capability": "physical.lock.status",   "safety_class": "A" }
  ]
}
```

`physical_safety: true` on a capability tells the gateway that any grant covering this capability defaults to L3 revocation: any revocation attempt goes through a multi-approver process rather than being instant.

### HITL workflow for physical access

Because `physical.lock.disengage` is safety class C, the operator defines a workflow:

```json
{
  "workflow_id": "front-door-unlock-approval",
  "trigger": { "kind": "capability_invocation", "capability_pattern": "physical.lock.disengage" },
  "required_channels": ["sms"],
  "max_total_duration_seconds": 120,
  "initial_stage_id": "ask",
  "stages": [
    {
      "stage_id": "ask",
      "duration_seconds": 60,
      "actions": [{ "channel": "sms", "method": "send",
        "params": { "body": "Unlock front door for {{caller_name}}? Reply YES or NO." }}],
      "listen": [
        { "channel": "sms", "pattern": "^YES$", "next": { "next_stage_id": "approved" } },
        { "channel": "sms", "pattern": "^NO$",  "next": { "next_stage_id": "denied" } }
      ],
      "on_timeout": { "next_stage_id": "denied" }
    },
    { "stage_id": "approved", "terminal": true, "terminal_outcome": "approved" },
    { "stage_id": "denied",   "terminal": true, "terminal_outcome": "denied" }
  ]
}
```

Now any actor invoking `physical.lock.disengage` gets a `pending_workflow` response. An SMS goes to the homeowner. Approval or denial produces a receipt. The full chain (who asked, who approved, when, via which channel) is in the receipt log.

### What this enables

- **Unified audit log** across all devices regardless of manufacturer.
- **Cross-device policy**: one grant can cover a class of devices; revoke the grant and the actor loses access to all of them simultaneously.
- **Capability scoping**: a cleaning service actor gets `home.lighting.control` and `home.climate.read` but never `physical.lock.*`.
- **Revocation on demand**: when a guest stay ends, revoke the guest actor's grant. Every subsequent invocation is denied, across every device.

---

## 3. Industrial Automation and OT

### The problem

Operational technology (OT) systems (PLCs, SCADA, DCS) were designed for isolation, not networked access. As AI-driven automation enters industrial environments, every vendor builds a custom integration layer. There is no standard for "an AI agent requests that this valve close" with a signed audit record and a multi-human approval process.

The consequences of a misconfigured or unauthorized command in an industrial setting are physical: spills, fires, injuries. Governance is not optional.

### Actors in an industrial context

```json
{
  "actor_type": "service",
  "actor_id": "service:process-ai-v3",
  "actor_name": "Process Optimization AI",
  "actor_version": "3.0.0",
  "capabilities": [
    {
      "capability": "physical.valve.close",
      "safety_class": "C",
      "physical_safety": true,
      "scope": { "asset_ids": ["valve-101", "valve-102"] }
    },
    {
      "capability": "physical.pump.set-speed",
      "safety_class": "C",
      "physical_safety": true
    },
    {
      "capability": "device.sensor.read",
      "safety_class": "A"
    }
  ]
}
```

### The grant reflects the safety architecture

The grant for class C capabilities can require multi-approver revocation and impose hard limits:

```json
{
  "capability_scopes": [
    {
      "capability": "physical.valve.close",
      "scope_narrowing": { "asset_ids": ["valve-101"] }
    }
  ],
  "limits": { "max_invocations_per_minute": 1, "max_invocations_total": 10 },
  "revocation_level_override": 3,
  "reason": "Scoped to valve-101 only, rate-limited to 1 close per minute, requires 3-party approval to revoke"
}
```

### L3 revocation in practice

If an anomaly is detected and the AI's access needs to be suspended immediately, the operator issues a provisional block:

```
POST /v1/gap/revoke/provisional-block
{ "target_oid": "<grant-oid>", "reason": "Suspected sensor spoofing event at 14:32" }
```

The block takes effect in milliseconds. The AI's next invocation is denied. The full L3 multi-approver process runs in parallel over the next 72 hours. The provisional block receipt is the evidence record for any incident investigation.

### What this enables

- **AI access to OT with a hard boundary**: the AI can only do what the grant allows, scoped to specific assets.
- **Rate limits as a safety mechanism**: no AI can close a valve more than once per minute regardless of what it decides.
- **Instant suspension**: provisional block is a single API call with millisecond effect.
- **Full incident audit trail**: every sensor read, every valve command, every approval, every denial is a signed receipt.
- **Regulatory compliance**: the receipt log is the evidence that every actuator command was authorized by a named human via a documented process.

---

## 4. Healthcare and Medical Devices

### The problem

A remote patient monitoring system wants an AI agent to adjust an insulin pump based on continuous glucose readings. The capability is real: it changes a patient's physiology. The governance requirement is absolute: who authorized this, when, based on what evidence, and who can revoke it.

Current medical device integrations have no standard for AI-requested commands. Each manufacturer builds a proprietary channel. The audit trail is in a different system from the device command log.

### Actors

```json
{
  "actor_type": "service",
  "actor_id": "service:glucose-ai-dosing",
  "actor_name": "Glucose-Responsive Dosing AI",
  "actor_version": "1.2.0",
  "capabilities": [
    {
      "capability": "medical.device.adjust-dose",
      "safety_class": "C",
      "physical_safety": true,
      "scope": {
        "device_types": ["insulin-pump"],
        "max_delta_units": 0.5,
        "requires_recent_reading_ms": 300000
      }
    },
    {
      "capability": "medical.device.read-telemetry",
      "safety_class": "A"
    }
  ]
}
```

### The grant encodes clinical policy

```json
{
  "capability_scopes": [
    {
      "capability": "medical.device.adjust-dose",
      "scope_narrowing": {
        "max_delta_units": 0.2,
        "min_glucose": 70,
        "max_glucose": 250
      },
      "additional_preconditions": [
        { "kind": "time_window", "args": { "start": "06:00", "end": "22:00" } },
        { "kind": "recent_reading", "args": { "max_age_ms": 300000 } }
      ]
    }
  ],
  "expires_at_ms": 1780000000000,
  "granted_by": "sha256:<physician-oid>",
  "evidence_oids": ["sha256:<prescription-oid>", "sha256:<patient-consent-oid>"]
}
```

The grant encodes clinical rules: only between 6am and 10pm, only when a glucose reading exists within 5 minutes, only adjustments of 0.2 units or less, only when glucose is in a defined range. The physician's OID and the prescription CDRO are in `evidence_oids`; every invocation receipt links back to the clinical authorization.

**scope_narrowing key note:** `min_glucose` and `max_glucose` are separate top-level flat keys. Nested object scope_narrowing (e.g. `"glucose_range_required": { "min": 70, "max": 250 }`) is not evaluated by the flat key algorithm and MUST NOT be used until nested evaluation is formally specified in the protocol. Use `min_glucose` and `max_glucose` as shown above.

### What this enables

- **Physician-authorized AI autonomy**: the AI can act within the grant boundary without per-action approval, but the grant itself required physician sign-off.
- **Hard safety boundaries enforced by the gateway**: the AI cannot exceed 0.2 units even if it decides it should, because the gateway enforces the scope_narrowing.
- **Regulatory audit trail**: the receipt log satisfies 21 CFR Part 11 electronic records requirements: who authorized, when, what evidence, what was done.
- **Instant revocation**: if the patient is hospitalized or the AI shows anomalous behavior, one revocation call blocks all further dose adjustments.

---

## 5. AI Agent Pipelines

### The problem

An AI agent needs to delegate work to a specialized sub-agent. The sub-agent needs access to tools (database, email, calendar, external API). Today the orchestrating agent passes credentials directly, a security anti-pattern, or the sub-agent runs with the same full permissions as the orchestrator.

GAP introduces **delegated capability grants**: the orchestrator grants the sub-agent a scoped subset of its own capabilities. The sub-agent can only do what the orchestrator explicitly authorized for this task. The receipt chain traces every action back to the root operator.

### Actors

```json
{
  "actor_type": "agent",
  "actor_id": "agent:research-sub-agent",
  "capabilities": [
    { "capability": "vault.read",          "safety_class": "A", "scope": { "namespaces": ["public"] } },
    { "capability": "mcp.tool.web-search",  "safety_class": "A" },
    { "capability": "mcp.tool.code-exec",   "safety_class": "B" },
    { "capability": "messaging.email.send", "safety_class": "B", "scope": { "domains": ["@acme.com"] } }
  ]
}
```

### Delegated grant (orchestrator to sub-agent)

The orchestrator agent issues a grant to the sub-agent scoped to this task:

```json
{
  "grantee": { "actor_type": "agent", "actor_oid": "sha256:<sub-agent-oid>" },
  "capability_scopes": [
    { "capability": "mcp.tool.web-search" },
    { "capability": "messaging.email.send",
      "scope_narrowing": { "domains": ["@acme.com"], "max_recipients": 1 } }
  ],
  "expires_at_ms": "<now + 1 hour>",
  "reason": "Research task: summarize ACME annual report and email to analyst@acme.com"
}
```

The sub-agent gets web search and one email to one recipient. It cannot access code execution, cannot email outside @acme.com, cannot touch the Vault. When the task ends, the grant expires automatically.

### What the receipt chain looks like

```
operator grant (root) ──► sub-agent grant (parent_grant_oid = root-grant-oid)
      │                              │
      └── receipt: grant_issued      └── receipt: grant_issued
                                              │
                                         sub-agent invocation
                                              │
                                     receipt: capability_invocation
                                              └── capability_grant_oids: [sub-agent-grant-oid]
```

Any reviewer can walk backward from the sub-agent's email send to the operator's original authorization in three hops. The `parent_grant_oid` on the sub-agent's grant links to the root; each grant receipt records its own issuance. The chain is verifiable by OID at each hop.

**Field clarification:** The receipt body has `capability_grant_oids` (grants evaluated during this invocation). The `evidence_oids` field on a grant body stores supporting documents (prescriptions, consent forms); it is not the delegation link. Use `parent_grant_oid` on the grant body for delegation chains.

### MCP tool servers as GAP actors

An MCP tool server registers each tool it exposes as a capability:

```json
{
  "actor_type": "mcp_server",
  "actor_id": "mcp:github-server",
  "capabilities": [
    { "capability": "mcp.tool.create-pr",  "safety_class": "B" },
    { "capability": "mcp.tool.merge-pr",   "safety_class": "C" },
    { "capability": "mcp.tool.read-repo",  "safety_class": "A" }
  ]
}
```

`mcp.tool.merge-pr` is safety class C: it triggers a HITL workflow. The developer gets an SMS: "AI agent wants to merge PR #42 in synoi/synoi-gateway. Approve?" Every merge has a signed receipt. The developer can look at any merge and see which agent did it, under which grant, after which approval.

### What this enables

- **Least-privilege AI delegation**: sub-agents get exactly the access they need for this task, nothing more.
- **Revokable agent access**: if an agent behaves unexpectedly, revoke its grant. Every subsequent tool call is denied immediately.
- **Attribution chain**: every action traces back to the root operator through the receipt chain; no "the AI did it" ambiguity.
- **Cross-LLM governance**: the grant structure is model-agnostic. A Claude agent, a GPT agent, and a Gemini agent can all be governed by the same GAP server.

---

## 6. Software Automation and Enterprise Integration

### The problem

An automation platform (n8n, Zapier, Make, Temporal) runs workflows that touch CRMs, ERPs, databases, email, Slack, and financial systems. Today the automation platform holds API keys to all of them. If the platform is compromised, every connected system is exposed. There is no per-workflow scoping, no audit trail at the action level, and no way to grant a specific workflow access to a specific operation without granting it access to everything.

### Automation workflows as GAP actors

Each workflow in the automation platform registers as an actor with the specific capabilities it uses:

```json
{
  "actor_type": "service",
  "actor_id": "service:monthly-invoice-workflow",
  "capabilities": [
    { "capability": "financial.invoice.create", "safety_class": "B" },
    { "capability": "financial.invoice.send",   "safety_class": "B" },
    { "capability": "vault.read", "safety_class": "A", "scope": { "namespaces": ["billing"] } },
    { "capability": "messaging.email.send", "safety_class": "A", "scope": { "domains": ["@customers.com"] } }
  ]
}
```

The grant for this workflow gives it access only to those four capabilities: it cannot read other Vault namespaces, cannot email outside customer domains, cannot create any other financial objects.

### What the invocation looks like from n8n

When the n8n workflow reaches the "create invoice" step, it calls:

```
POST /v1/gap/invocations
{
  "caller": { "actor_oid": "sha256:<invoice-workflow-oid>", "grant_oid": "sha256:<grant-oid>" },
  "capability": "financial.invoice.create",
  "args": {
    "customer_id": "cust-8821",
    "line_items": [...],
    "due_date": "2026-07-24"
  },
  "idempotency_key": "invoice-run-2026-06-24-cust-8821"
}
```

The receipt records when the invoice was created, by which workflow, under which grant. If an invoice is disputed, the audit trail is one query away.

### Enterprise system patterns

**ERP access:**
```
capability: "erp.purchase-order.approve"
safety_class: "C"
workflow trigger: "capability_invocation", pattern: "erp.purchase-order.approve"
```
Any AI-driven PO approval over a threshold triggers a HITL workflow. The finance manager gets an SMS or email. Approval is recorded. The ERP receives the command only after human sign-off.

**CRM writes:**
```
capability: "crm.contact.update"
safety_class: "B"
scope_narrowing: { "fields": ["notes", "last_contacted_at"] }
```
An AI agent can update notes and contact timestamps but cannot change the owner, delete records, or modify financial fields. The scope_narrowing is enforced by the gateway, not by trusting the AI to behave correctly.

### What this enables

- **Per-workflow least privilege**: each workflow gets exactly the access it needs.
- **Platform-level audit trail**: every action across every automation tool is in one receipt log.
- **Break-glass revocation**: if any workflow behaves incorrectly, revoke its grant in one call.
- **Approval gates without custom code**: any automation step can be made HITL by matching it to a workflow definition, without modifying the automation platform.

---

## 7. Physical Security and Access Control

### The problem

Building access, parking, server rooms, and restricted areas all have separate badge systems with separate audit logs. An AI visitor management system, a contractor onboarding tool, and an emergency response system all need to issue and revoke access. Each integration is custom. Revocation across all systems simultaneously is a manual process.

### Actors and capability taxonomy

```json
{
  "actor_type": "service",
  "actor_id": "service:visitor-management",
  "capabilities": [
    { "capability": "physical.access.grant-temporary", "safety_class": "C", "physical_safety": true },
    { "capability": "physical.access.revoke",          "safety_class": "C", "physical_safety": true },
    { "capability": "physical.access.read-log",        "safety_class": "A" }
  ]
}
```

### Cross-system revocation in an emergency

In an emergency, a security officer issues one provisional block on the visitor management system's grant:

```
POST /v1/gap/revoke/provisional-block
{ "target_oid": "<visitor-mgmt-grant-oid>", "reason": "Security incident at north entrance 14:47" }
```

Every subsequent `physical.access.grant-temporary` invocation from that system is denied immediately, across every door reader integrated to the GAP gateway. The L3 review process runs in parallel over 72 hours. The security team does not need to log into each badge system separately.

---

## 8. Cross-Environment Scenarios

These scenarios are only possible because all environments speak the same protocol.

### Scenario A: Game crosses into physical world

A player enters a dark underwater cave in the game. The game engine invokes:

1. `home.lighting.control` (room: living-room, brightness: 10%), via Home Assistant channel
2. `device.haptic.pulse` (pattern: slow-pulse, duration_ms: 5000), via mobile push channel
3. `home.audio.ambient` (track: underwater, volume: 40%), via smart speaker channel

All three happen in parallel from one grant. Three receipts are produced. The player leaves the cave, and the game invokes the reverse. The operator can see in their receipt log exactly when the game dimmed the lights, for how long, and what ambient audio was playing.

**The grant revocation story**: the player stops playing the game. They revoke the game engine's grant. The game calls `home.lighting.control` on the next session launch: denied, receipt logged. The lights never change.

### Scenario B: Industrial AI triggers human escalation triggers physical action

A process AI detects a pressure anomaly in a chemical reactor. It invokes `physical.valve.close` for valve-101 (safety class C). The gateway:

1. Returns `pending_workflow` immediately.
2. Starts the approval workflow.
3. Sends SMS to two on-call engineers.
4. First engineer replies YES within 30 seconds.
5. Workflow transitions to `approved`.
6. Gateway executes `physical.valve.close` on the SCADA adapter.
7. Final receipt records: AI request, both engineer SMSes, approval, execution time, SCADA response.

The entire chain, from the AI's decision to the physical valve position, is in one linked receipt chain. One query retrieves the full incident record.

### Scenario C: AI agent in software environment governs real-world device

A developer's AI coding assistant (Claude, GPT, or any MCP-capable agent) is given a grant that includes `messaging.push.send` and `home.lighting.control`. When it completes a build run:

1. It invokes `home.lighting.control` (room: office, brightness: 100%, color: green): "build passed" signal.
2. It invokes `messaging.push.send` (topic: build-status, body: "Build passed. 142 tests green.").

Both invocations go through the GAP server. Both produce receipts. The developer can see in their audit log: at 14:32:08, the coding agent turned the office lights green and sent a push notification, under grant sha256:f4a2..., which was issued at 09:00:00 and expires at 18:00:00.

The developer goes home and the grant expires. The agent can no longer control the lights or send push notifications.

### Scenario D: Medical device AI escalates to physician then executes

A remote ICU monitoring AI detects a patient trend requiring a medication adjustment. It invokes `medical.device.adjust-dose`. Because the grant requires a physician precondition for adjustments above 0.1 units, the gateway:

1. Starts a HITL workflow.
2. Notifies the on-call physician via pager channel.
3. Physician opens the mobile app, reviews the AI's reasoning (provided as `args.rationale` in the invocation), and approves.
4. The approval channel event transitions the workflow to `approved`.
5. The gateway executes the dose adjustment on the infusion pump adapter.
6. The final receipt chain links: patient ID, AI's decision rationale, sensor readings that triggered the decision, physician approval, the dose change applied, and the timestamp of each step.

The care team, risk management, and regulators can reconstruct the full clinical decision chain from a single receipt OID.

---

## The common thread

In every environment above, the same four things happen:

1. **Declare**: an actor says what it can do, in the vocabulary of its domain.
2. **Grant**: an operator says who is allowed to do it, and under what conditions.
3. **Invoke**: an actor asks the gateway to execute a capability.
4. **Receipt**: a signed, immutable record is produced regardless of outcome.

The protocol is the same. The capability names, channel adapters, and safety classes change per environment. The operator's grant is the policy. The receipt is the evidence. The revocation is the emergency stop.

GAP does not replace domain-specific protocols inside each environment. It provides the coordination and accountability layer that sits above all of them: the shared vocabulary that lets a game engine, a SCADA adapter, an AI agent, and a medical device participate in the same governed action fabric.
