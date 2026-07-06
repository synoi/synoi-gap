/**
 * test/round-trip.test.ts -- serialize, parse, validate.
 *
 * For every top-level CDRO type, build an envelope with the proper OID,
 * JSON.stringify it, JSON.parse it back, and assert the validator returns
 * ok=true AND the parsed envelope is structurally equal to the source.
 */

import {
  computeGapOid,
  validateGapDecisionReceipt,
  validateCapabilityDeclaration,
  validateCapabilityGrant,
  validateCapabilityInvocation,
  validateChannelEvent,
  validateRevocationEvent,
  validateStageTransition,
  validateWorkflowDefinition,
  validateWorkflowInstance,
  type GapCdroEnvelope,
  type GapDecisionReceipt,
  type GapDecisionReceiptBody,
  type GapObjectType,
  type CapabilityDeclaration,
  type CapabilityDeclarationBody,
  type CapabilityGrant,
  type CapabilityGrantBody,
  type CapabilityInvocation,
  type CapabilityInvocationBody,
  type ChannelEvent,
  type ChannelEventBody,
  type RevocationEvent,
  type RevocationEventBody,
  type StageTransition,
  type StageTransitionBody,
  type WorkflowDefinition,
  type WorkflowDefinitionBody,
  type WorkflowInstance,
  type WorkflowInstanceBody,
} from '../src/index.js'

let passed = 0, failed = 0
function ok(label: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; process.stdout.write(`OK   ${label}\n`) }
  else      { failed++; process.stdout.write(`FAIL ${label}${detail ? ' - ' + detail : ''}\n`) }
}

function buildEnvelope<T>(type: GapObjectType, tenant_id: string, created_by: string, body: T): GapCdroEnvelope<T> {
  const created_at_ms = 1700000000000
  const payloadForOid = { type, tenant_id, created_at_ms, created_by, body }
  const oid = computeGapOid(payloadForOid)
  return {
    oid,
    type,
    gap_version: '1.0',
    tenant_id,
    created_at_ms,
    created_by,
    body,
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b) return false
  if (a === null || b === null) return a === b
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false
    return true
  }
  if (typeof a === 'object') {
    const ao = a as Record<string, unknown>
    const bo = b as Record<string, unknown>
    const ak = Object.keys(ao).sort()
    const bk = Object.keys(bo).sort()
    if (ak.length !== bk.length) return false
    for (let i = 0; i < ak.length; i++) {
      if (ak[i] !== bk[i]) return false
      const key = ak[i] as string
      if (!deepEqual(ao[key], bo[key])) return false
    }
    return true
  }
  return false
}

// -- 1. CapabilityDeclaration ------------------------------------------------

{
  const body: CapabilityDeclarationBody = {
    actor_type: 'skill',
    actor_id: 'skill:demo',
    actor_name: 'Demo',
    actor_version: '1.0.0',
    capabilities: [
      { capability: 'demo.say_hello', safety_class: 'A' },
      { capability: 'demo.say_goodbye', physical_safety: false },
    ],
    human_summary: 'Demo skill.',
  }
  const env: CapabilityDeclaration =
    buildEnvelope('gap:capability_declaration', 'tenant-rt', 'actor:operator', body)
  const parsed = JSON.parse(JSON.stringify(env)) as CapabilityDeclaration
  const r = validateCapabilityDeclaration(parsed)
  ok('round-trip declaration: validates ok=true', r.ok, r.errors.join('; '))
  ok('round-trip declaration: deep equal', deepEqual(env, parsed))
}

// -- 2. CapabilityGrant ------------------------------------------------------

{
  const body: CapabilityGrantBody = {
    grantee: { actor_type: 'skill', actor_oid: 'actor:abc' },
    capability_scopes: [{ capability: 'demo.*' }],
    granted_at_ms: 1700000001000,
    expires_at_ms: 1700000999000,
    granted_by: 'actor:operator',
    limits: { max_invocations_per_minute: 60 },
  }
  const env: CapabilityGrant =
    buildEnvelope('gap:capability_grant', 'tenant-rt', 'actor:operator', body)
  const parsed = JSON.parse(JSON.stringify(env)) as CapabilityGrant
  const r = validateCapabilityGrant(parsed)
  ok('round-trip grant: validates ok=true', r.ok, r.errors.join('; '))
  ok('round-trip grant: deep equal', deepEqual(env, parsed))
}

// -- 3. CapabilityInvocation -------------------------------------------------

{
  const body: CapabilityInvocationBody = {
    caller: { actor_type: 'skill', actor_oid: 'actor:abc', grant_oid: 'sha256:grant' },
    capability: 'demo.say_hello',
    capability_declaration_oid: 'sha256:decl',
    args: { name: 'world' },
    invoked_at_ms: 1700000002000,
  }
  const env: CapabilityInvocation =
    buildEnvelope('gap:capability_invocation', 'tenant-rt', 'actor:abc', body)
  const parsed = JSON.parse(JSON.stringify(env)) as CapabilityInvocation
  const r = validateCapabilityInvocation(parsed)
  ok('round-trip invocation: validates ok=true', r.ok, r.errors.join('; '))
  ok('round-trip invocation: deep equal', deepEqual(env, parsed))
}

// -- 4. WorkflowDefinition ---------------------------------------------------

{
  const body: WorkflowDefinitionBody = {
    workflow_id: 'wf-1',
    workflow_name: 'Workflow 1',
    workflow_version: '1.0.0',
    trigger: { kind: 'capability_invocation', capability_pattern: 'demo.*' },
    stages: [
      { stage_id: 'start' },
      { stage_id: 'done', terminal: true, terminal_outcome: 'approved' },
    ],
    initial_stage_id: 'start',
    required_channels: ['sms'],
    max_total_duration_seconds: 600,
  }
  const env: WorkflowDefinition =
    buildEnvelope('gap:workflow_definition', 'tenant-rt', 'actor:operator', body)
  const parsed = JSON.parse(JSON.stringify(env)) as WorkflowDefinition
  const r = validateWorkflowDefinition(parsed)
  ok('round-trip workflow def: validates ok=true', r.ok, r.errors.join('; '))
  ok('round-trip workflow def: deep equal', deepEqual(env, parsed))
}

// -- 5. WorkflowInstance -----------------------------------------------------

{
  const body: WorkflowInstanceBody = {
    workflow_definition_oid: 'sha256:wfdef',
    workflow_id: 'wf-1',
    trigger_event: { kind: 'capability_invocation', source_actor_oid: 'actor:abc' },
    current_stage_id: 'start',
    scope_variables: { user: 'world' },
    started_at_ms: 1700000003000,
    last_transition_at_ms: 1700000003000,
    terminated_at_ms: null,
    terminal_outcome: null,
    active_channel_listeners: [],
    transition_oids: [],
  }
  const env: WorkflowInstance =
    buildEnvelope('gap:workflow_instance', 'tenant-rt', 'actor:operator', body)
  const parsed = JSON.parse(JSON.stringify(env)) as WorkflowInstance
  const r = validateWorkflowInstance(parsed)
  ok('round-trip workflow inst: validates ok=true', r.ok, r.errors.join('; '))
  ok('round-trip workflow inst: deep equal', deepEqual(env, parsed))
}

// -- 6. StageTransition ------------------------------------------------------

{
  const body: StageTransitionBody = {
    workflow_instance_oid: 'sha256:wfinst',
    previous_transition_oid: null,
    from_stage_id: 'start',
    to_stage_id: 'done',
    trigger_reason: 'action_completed',
    bind_outputs: { reply: 'YES' },
    transitioned_at_ms: 1700000004000,
  }
  const env: StageTransition =
    buildEnvelope('gap:stage_transition', 'tenant-rt', 'actor:operator', body)
  const parsed = JSON.parse(JSON.stringify(env)) as StageTransition
  const r = validateStageTransition(parsed)
  ok('round-trip stage transition: validates ok=true', r.ok, r.errors.join('; '))
  ok('round-trip stage transition: deep equal', deepEqual(env, parsed))
}

// -- 7. ChannelEvent ---------------------------------------------------------

{
  const body: ChannelEventBody = {
    channel: 'sms',
    event_kind: 'inbound_message',
    payload: { body: 'YES', from: '+15555550100' },
    observed_at_ms: 1700000005000,
  }
  const env: ChannelEvent =
    buildEnvelope('gap:channel_event', 'tenant-rt', 'actor:gateway', body)
  const parsed = JSON.parse(JSON.stringify(env)) as ChannelEvent
  const r = validateChannelEvent(parsed)
  ok('round-trip channel event: validates ok=true', r.ok, r.errors.join('; '))
  ok('round-trip channel event: deep equal', deepEqual(env, parsed))
}

// -- 8. GapDecisionReceipt ---------------------------------------------------

{
  const body: GapDecisionReceiptBody = {
    subject_kind: 'capability_invocation',
    subject_oid: 'sha256:inv',
    initiator: { actor_oid: 'actor:abc', actor_type: 'skill' },
    status: 'ok',
    initiated_at_ms: 1700000006000,
    resolved_at_ms: 1700000006001,
    metrics: { latency_ms: 1 },
  }
  const env: GapDecisionReceipt =
    buildEnvelope('gap:decision_receipt', 'tenant-rt', 'actor:gateway', body)
  const parsed = JSON.parse(JSON.stringify(env)) as GapDecisionReceipt
  const r = validateGapDecisionReceipt(parsed)
  ok('round-trip receipt: validates ok=true', r.ok, r.errors.join('; '))
  ok('round-trip receipt: deep equal', deepEqual(env, parsed))
}

// -- 8b. GapDecisionReceipt with [0024] measured block -----------------------

{
  const body: GapDecisionReceiptBody = {
    subject_kind: 'capability_invocation',
    subject_oid: 'sha256:inv-measured',
    initiator: { actor_oid: 'actor:abc', actor_type: 'skill' },
    status: 'ok',
    initiated_at_ms: 1700000007000,
    resolved_at_ms: 1700000007412,
    measured: {
      cost_micro_usd: 2100,
      latency_ms: 412,
      provider_ran: 'composio',
      counterparty: 'recipient:opaque-token-abc',
      upstream_ref: 'sha256:0000000000000000000000000000000000000000000000000000000000000001',
    },
  }
  const env: GapDecisionReceipt =
    buildEnvelope('gap:decision_receipt', 'tenant-rt', 'actor:gateway', body)
  const parsed = JSON.parse(JSON.stringify(env)) as GapDecisionReceipt
  const r = validateGapDecisionReceipt(parsed)
  ok('round-trip receipt+measured: validates ok=true', r.ok, r.errors.join('; '))
  ok('round-trip receipt+measured: deep equal', deepEqual(env, parsed))
  ok('round-trip receipt+measured: provider_ran preserved',
     parsed.body.measured?.provider_ran === 'composio')
}

// -- 9. RevocationEvent ------------------------------------------------------

{
  const body: RevocationEventBody = {
    target_kind: 'capability_grant',
    target_oid: 'sha256:grant',
    reason: 'compromised',
    required_level: 1,
    provisional: false,
    approvers: [
      { actor_oid: 'actor:operator', approved_at_ms: 1700000007000, cooling_off_satisfied: true },
    ],
    effective_at_ms: 1700000007000,
  }
  const env: RevocationEvent =
    buildEnvelope('gap:revocation_event', 'tenant-rt', 'actor:operator', body)
  const parsed = JSON.parse(JSON.stringify(env)) as RevocationEvent
  const r = validateRevocationEvent(parsed)
  ok('round-trip revocation: validates ok=true', r.ok, r.errors.join('; '))
  ok('round-trip revocation: deep equal', deepEqual(env, parsed))
}

process.stdout.write(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed > 0 ? 1 : 0)
