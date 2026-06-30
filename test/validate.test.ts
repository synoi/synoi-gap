/**
 * test/validate.test.ts -- every validator's happy + bad-input paths.
 *
 * Style copies the gateway test harness: standalone tsx-run script, manual
 * `ok()` counter, process.exit at the end.
 */

import {
  validateCapabilityDeclaration,
  validateCapabilityDeclarationBody,
  validateCapabilityGrant,
  validateCapabilityGrantBody,
  validateCapabilityInvocation,
  validateCapabilityInvocationBody,
  validateWorkflowDefinition,
  validateWorkflowDefinitionBody,
  validateWorkflowInstance,
  validateWorkflowInstanceBody,
  validateStageTransition,
  validateStageTransitionBody,
  validateChannelEvent,
  validateChannelEventBody,
  validateGapDecisionReceipt,
  validateGapDecisionReceiptBody,
  validateRevocationEvent,
  validateRevocationEventBody,
} from '../src/index.js'

let passed = 0, failed = 0
function ok(label: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; process.stdout.write(`OK   ${label}\n`) }
  else      { failed++; process.stdout.write(`FAIL ${label}${detail ? ' - ' + detail : ''}\n`) }
}

function envOk(type: string, body: unknown): Record<string, unknown> {
  return {
    oid: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    type,
    gap_version: '1.0',
    tenant_id: 'tenant-test',
    created_at_ms: 1700000000000,
    created_by: 'actor:operator',
    body,
  }
}

// -- CapabilityDeclaration ---------------------------------------------------

const goodDeclBody = {
  actor_type: 'skill',
  actor_id: 'skill:demo',
  actor_name: 'Demo',
  actor_version: '1.0.0',
  capabilities: [{ capability: 'demo.say_hello', safety_class: 'A' }],
}
{
  const r = validateCapabilityDeclaration(envOk('gap:capability_declaration', goodDeclBody))
  ok('declaration: well-formed => ok=true', r.ok && r.errors.length === 0,
     r.errors.join('; '))
}
{
  const bad = envOk('gap:capability_declaration', { ...goodDeclBody, actor_id: undefined })
  delete (bad['body'] as Record<string, unknown>)['actor_id']
  const r = validateCapabilityDeclaration(bad)
  ok('declaration: missing actor_id => ok=false with named error',
     !r.ok && r.errors.some((e) => e.includes('actor_id')))
}
{
  const bad = envOk('gap:capability_declaration', { ...goodDeclBody, actor_type: 'not_a_real_type' })
  const r = validateCapabilityDeclaration(bad)
  ok('declaration: wrong actor_type => ok=false with type error',
     !r.ok && r.errors.some((e) => e.includes('actor_type')))
}
{
  const r = validateCapabilityDeclaration(envOk('gap:capability_grant', goodDeclBody))
  ok('declaration: wrong envelope.type => ok=false',
     !r.ok && r.errors.some((e) => e.includes('envelope.type')))
}
{
  const r = validateCapabilityDeclarationBody({ ...goodDeclBody, capabilities: 'not-an-array' })
  ok('declaration body: wrong capabilities type => ok=false',
     !r.ok && r.errors.some((e) => e.includes('capabilities')))
}

// -- CapabilityGrant ---------------------------------------------------------

const goodGrantBody = {
  grantee: { actor_type: 'skill', actor_oid: 'actor:abc' },
  capability_scopes: [{ capability: 'demo.*' }],
  granted_at_ms: 1700000001000,
  expires_at_ms: null,
  granted_by: 'actor:operator',
}
{
  const r = validateCapabilityGrant(envOk('gap:capability_grant', goodGrantBody))
  ok('grant: well-formed (null expiry) => ok=true', r.ok, r.errors.join('; '))
}
{
  const r = validateCapabilityGrant(envOk('gap:capability_grant', { ...goodGrantBody, expires_at_ms: 1700000999000 }))
  ok('grant: well-formed (numeric expiry) => ok=true', r.ok, r.errors.join('; '))
}
{
  const r = validateCapabilityGrantBody({ ...goodGrantBody, granted_by: undefined })
  ok('grant body: missing granted_by => ok=false',
     !r.ok && r.errors.some((e) => e.includes('granted_by')))
}
{
  const r = validateCapabilityGrantBody({ ...goodGrantBody, capability_scopes: 'nope' })
  ok('grant body: wrong capability_scopes type => ok=false',
     !r.ok && r.errors.some((e) => e.includes('capability_scopes')))
}
{
  const r = validateCapabilityGrantBody({ ...goodGrantBody, expires_at_ms: 'soon' })
  ok('grant body: wrong expires_at_ms type => ok=false',
     !r.ok && r.errors.some((e) => e.includes('expires_at_ms')))
}
{
  const r = validateCapabilityGrantBody({ ...goodGrantBody, revocation_level_override: 5 })
  ok('grant body: bad revocation_level_override => ok=false',
     !r.ok && r.errors.some((e) => e.includes('revocation_level_override')))
}

// -- CapabilityInvocation ----------------------------------------------------

const goodInvBody = {
  caller: { actor_type: 'skill', actor_oid: 'actor:abc', grant_oid: 'sha256:deadbeef' },
  capability: 'demo.say_hello',
  capability_declaration_oid: 'sha256:cafebabe',
  args: { greeting: 'hello' },
  invoked_at_ms: 1700000002000,
}
{
  const r = validateCapabilityInvocation(envOk('gap:capability_invocation', goodInvBody))
  ok('invocation: well-formed => ok=true', r.ok, r.errors.join('; '))
}
{
  const r = validateCapabilityInvocationBody({ ...goodInvBody, caller: { actor_type: 'skill' } })
  ok('invocation body: caller missing actor_oid + grant_oid => ok=false',
     !r.ok && r.errors.some((e) => e.includes('actor_oid')) && r.errors.some((e) => e.includes('grant_oid')))
}
{
  const r = validateCapabilityInvocationBody({ ...goodInvBody, args: 'not-an-object' })
  ok('invocation body: wrong args type => ok=false',
     !r.ok && r.errors.some((e) => e.includes('args')))
}

// -- Integer-only numeric field enforcement ----------------------------------
// GAP 1.0 canonicalize rejects floats in hashed fields; validators must catch
// them before computeGapOid is called.

{
  ok('grant body: expires_at_ms float => ok=false',
     !validateCapabilityGrantBody({ ...goodGrantBody, expires_at_ms: 1.5 }).ok)
}
{
  ok('grant body: expires_at_ms integer => ok=true',
     validateCapabilityGrantBody({ ...goodGrantBody, expires_at_ms: 1700000000000 }).ok)
}
{
  const badEnv = { ...envOk('gap:capability_declaration', goodDeclBody), created_at_ms: 1.5 }
  ok('envelope: created_at_ms float => ok=false',
     validateCapabilityDeclaration(badEnv).errors.length > 0)
}

// -- WorkflowDefinition ------------------------------------------------------

const goodWfDefBody = {
  workflow_id: 'wf-demo',
  workflow_name: 'Demo Workflow',
  workflow_version: '1.0.0',
  trigger: { kind: 'explicit' },
  stages: [{ stage_id: 'start', terminal: true, terminal_outcome: 'approved' }],
  initial_stage_id: 'start',
  required_channels: [],
  max_total_duration_seconds: 60,
}
{
  const r = validateWorkflowDefinition(envOk('gap:workflow_definition', goodWfDefBody))
  ok('workflow def: well-formed => ok=true', r.ok, r.errors.join('; '))
}
{
  const r = validateWorkflowDefinitionBody({ ...goodWfDefBody, trigger: { kind: 'not-a-kind' } })
  ok('workflow def body: bad trigger.kind => ok=false',
     !r.ok && r.errors.some((e) => e.includes('trigger.kind')))
}
{
  const r = validateWorkflowDefinitionBody({ ...goodWfDefBody, required_channels: undefined })
  ok('workflow def body: missing required_channels => ok=false',
     !r.ok && r.errors.some((e) => e.includes('required_channels')))
}

// -- WorkflowInstance --------------------------------------------------------

const goodWfInstBody = {
  workflow_definition_oid: 'sha256:wfdef',
  workflow_id: 'wf-demo',
  trigger_event: { kind: 'explicit', source_actor_oid: 'actor:operator' },
  current_stage_id: 'start',
  scope_variables: {},
  started_at_ms: 1700000003000,
  last_transition_at_ms: 1700000003000,
  terminated_at_ms: null,
  terminal_outcome: null,
  active_channel_listeners: [],
  transition_oids: [],
}
{
  const r = validateWorkflowInstance(envOk('gap:workflow_instance', goodWfInstBody))
  ok('workflow inst: well-formed => ok=true', r.ok, r.errors.join('; '))
}
{
  const r = validateWorkflowInstanceBody({ ...goodWfInstBody, terminal_outcome: 'bogus' })
  ok('workflow inst body: bad terminal_outcome => ok=false',
     !r.ok && r.errors.some((e) => e.includes('terminal_outcome')))
}
{
  const r = validateWorkflowInstanceBody({ ...goodWfInstBody, trigger_event: { kind: 'explicit' } })
  ok('workflow inst body: trigger_event missing source_actor_oid => ok=false',
     !r.ok && r.errors.some((e) => e.includes('source_actor_oid')))
}

// -- StageTransition ---------------------------------------------------------

const goodTxBody = {
  workflow_instance_oid: 'sha256:wfinst',
  previous_transition_oid: null,
  from_stage_id: 'start',
  to_stage_id: 'next',
  trigger_reason: 'action_completed',
  bind_outputs: {},
  transitioned_at_ms: 1700000004000,
}
{
  const r = validateStageTransition(envOk('gap:stage_transition', goodTxBody))
  ok('stage transition: well-formed => ok=true', r.ok, r.errors.join('; '))
}
{
  const r = validateStageTransitionBody({ ...goodTxBody, trigger_reason: 'made-it-up' })
  ok('stage transition body: bad trigger_reason => ok=false',
     !r.ok && r.errors.some((e) => e.includes('trigger_reason')))
}

// -- ChannelEvent ------------------------------------------------------------

const goodChanBody = {
  channel: 'sms',
  event_kind: 'inbound_message',
  payload: { body: 'YES' },
  observed_at_ms: 1700000005000,
}
{
  const r = validateChannelEvent(envOk('gap:channel_event', goodChanBody))
  ok('channel event: well-formed => ok=true', r.ok, r.errors.join('; '))
}
{
  const r = validateChannelEventBody({ ...goodChanBody, payload: 'string' })
  ok('channel event body: payload not object => ok=false',
     !r.ok && r.errors.some((e) => e.includes('payload')))
}

// -- GapDecisionReceipt ------------------------------------------------------

const goodReceiptBody = {
  subject_kind: 'capability_invocation',
  subject_oid: 'sha256:inv',
  initiator: { actor_oid: 'actor:abc', actor_type: 'skill' },
  status: 'ok',
  initiated_at_ms: 1700000006000,
  resolved_at_ms: 1700000006001,
}
{
  const r = validateGapDecisionReceipt(envOk('gap:decision_receipt', goodReceiptBody))
  ok('receipt: well-formed => ok=true', r.ok, r.errors.join('; '))
}
{
  const r = validateGapDecisionReceiptBody({ ...goodReceiptBody, status: 'maybe' })
  ok('receipt body: bad status => ok=false',
     !r.ok && r.errors.some((e) => e.includes('status')))
}
{
  const r = validateGapDecisionReceiptBody({ ...goodReceiptBody, initiator: { actor_oid: 'actor:abc' } })
  ok('receipt body: initiator missing actor_type => ok=false',
     !r.ok && r.errors.some((e) => e.includes('actor_type')))
}

// -- RevocationEvent ---------------------------------------------------------

const goodRevBody = {
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
{
  const r = validateRevocationEvent(envOk('gap:revocation_event', goodRevBody))
  ok('revocation: well-formed => ok=true', r.ok, r.errors.join('; '))
}
{
  const r = validateRevocationEventBody({ ...goodRevBody, required_level: 7 })
  ok('revocation body: bad required_level => ok=false',
     !r.ok && r.errors.some((e) => e.includes('required_level')))
}
{
  const r = validateRevocationEventBody({ ...goodRevBody, approvers: [{ actor_oid: 'actor:o' }] })
  ok('revocation body: approver missing approved_at_ms => ok=false',
     !r.ok && r.errors.some((e) => e.includes('approved_at_ms')))
}

// -- RevocationEvent: provisional_block_policy + min_approvers ---------------
// These fields were added in the last commit. Cover all documented valid/invalid
// combinations per validateRevocationEventBody.

{
  const r = validateRevocationEventBody({
    ...goodRevBody,
    provisional_block_policy: { on_expiry_without_quorum: 'renew' },
  })
  ok('revocation body: provisional_block_policy on_expiry_without_quorum=renew => ok=true',
     r.ok, r.errors.join('; '))
}
{
  const r = validateRevocationEventBody({
    ...goodRevBody,
    provisional_block_policy: { on_expiry_without_quorum: 'revert' },
  })
  ok('revocation body: provisional_block_policy on_expiry_without_quorum=revert => ok=true',
     r.ok, r.errors.join('; '))
}
{
  const r = validateRevocationEventBody({
    ...goodRevBody,
    provisional_block_policy: { on_expiry_without_quorum: 'invalid' },
  })
  ok('revocation body: provisional_block_policy on_expiry_without_quorum=invalid => ok=false',
     !r.ok && r.errors.some((e) => e.includes('on_expiry_without_quorum')))
}
{
  const r = validateRevocationEventBody({ ...goodRevBody, min_approvers: 2 })
  ok('revocation body: min_approvers=2 => ok=true', r.ok, r.errors.join('; '))
}
{
  const r = validateRevocationEventBody({ ...goodRevBody, min_approvers: 0 })
  ok('revocation body: min_approvers=0 => ok=false (must be positive)',
     !r.ok && r.errors.some((e) => e.includes('min_approvers')))
}
{
  const r = validateRevocationEventBody({ ...goodRevBody, min_approvers: -1 })
  ok('revocation body: min_approvers=-1 => ok=false',
     !r.ok && r.errors.some((e) => e.includes('min_approvers')))
}
{
  const r = validateRevocationEventBody({ ...goodRevBody, min_approvers: 1.5 })
  ok('revocation body: min_approvers=1.5 => ok=false (must be integer)',
     !r.ok && r.errors.some((e) => e.includes('min_approvers')))
}

// -- CapabilityGrant: aggregate_limits ---------------------------------------
// aggregate_limits is nested under body.limits. Cover valid + all invalid paths.

{
  const r = validateCapabilityGrantBody({
    ...goodGrantBody,
    limits: { aggregate_limits: [{ key: 'amount_usd', max: 10000, window_seconds: 3600 }] },
  })
  ok('grant body: aggregate_limits valid entry => ok=true', r.ok, r.errors.join('; '))
}
{
  const r = validateCapabilityGrantBody({
    ...goodGrantBody,
    limits: { aggregate_limits: [{ key: 'amount_usd', max: -1, window_seconds: 3600 }] },
  })
  ok('grant body: aggregate_limits max=-1 => ok=false (max must be >= 0)',
     !r.ok && r.errors.some((e) => e.includes('max')))
}
{
  const r = validateCapabilityGrantBody({
    ...goodGrantBody,
    limits: { aggregate_limits: [{ key: 'amount_usd', max: 1000, window_seconds: 0 }] },
  })
  ok('grant body: aggregate_limits window_seconds=0 => ok=false (must be > 0)',
     !r.ok && r.errors.some((e) => e.includes('window_seconds')))
}
{
  const r = validateCapabilityGrantBody({
    ...goodGrantBody,
    limits: { aggregate_limits: [{ key: 123, max: 1000, window_seconds: 3600 }] },
  })
  ok('grant body: aggregate_limits key=123 (not string) => ok=false',
     !r.ok && r.errors.some((e) => e.includes('key')))
}
{
  // max=0 is exactly the lower boundary; must be valid (>= 0)
  const r = validateCapabilityGrantBody({
    ...goodGrantBody,
    limits: { aggregate_limits: [{ key: 'count', max: 0, window_seconds: 60 }] },
  })
  ok('grant body: aggregate_limits max=0 => ok=true (boundary: >= 0)',
     r.ok, r.errors.join('; '))
}

// -- WorkflowDefinition: authorized_approvers on stages ----------------------

{
  const stageWithApprovers = {
    ...goodWfDefBody,
    stages: [{ stage_id: 'start', terminal: true, terminal_outcome: 'approved',
                authorized_approvers: ['sha256:abc'] }],
  }
  const r = validateWorkflowDefinitionBody(stageWithApprovers)
  ok('workflow def body: stage authorized_approvers string[] => ok=true',
     r.ok, r.errors.join('; '))
}
{
  const stageWithBadApprovers = {
    ...goodWfDefBody,
    stages: [{ stage_id: 'start', terminal: true, terminal_outcome: 'approved',
                authorized_approvers: [123] }],
  }
  const r = validateWorkflowDefinitionBody(stageWithBadApprovers)
  ok('workflow def body: stage authorized_approvers [123] (not string[]) => ok=false',
     !r.ok && r.errors.some((e) => e.includes('authorized_approvers')))
}
{
  const stageWithEmptyApprovers = {
    ...goodWfDefBody,
    stages: [{ stage_id: 'start', terminal: true, terminal_outcome: 'approved',
                authorized_approvers: [] }],
  }
  const r = validateWorkflowDefinitionBody(stageWithEmptyApprovers)
  ok('workflow def body: stage authorized_approvers=[] (empty array) => ok=true',
     r.ok, r.errors.join('; '))
}

// -- Generic envelope errors -------------------------------------------------

{
  const bad = envOk('gap:capability_declaration', goodDeclBody)
  bad['gap_version'] = '99.0'
  const r = validateCapabilityDeclaration(bad)
  ok('envelope: wrong gap_version => ok=false',
     !r.ok && r.errors.some((e) => e.includes('gap_version')))
}
{
  const bad = envOk('gap:capability_declaration', goodDeclBody)
  bad['oid'] = 'md5:not-a-real-oid'
  const r = validateCapabilityDeclaration(bad)
  ok('envelope: oid without sha256: prefix => ok=false',
     !r.ok && r.errors.some((e) => e.includes('sha256:')))
}
{
  const r = validateCapabilityDeclaration(null)
  ok('envelope: null input => ok=false',
     !r.ok && r.errors.length > 0)
}

process.stdout.write(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed > 0 ? 1 : 0)
