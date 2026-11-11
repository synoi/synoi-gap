/**
 * test/agent-schema.test.ts -- the agent + owner registry schema.
 *
 * schemas/agent.json is the cross-repo shape of a registered agent (the
 * gateway's GET /v1/account/agents rows), its owner events (each one
 * receipted), and the "ownerless agent" finding. synoi-gateway
 * (src/agents/registry.ts) drift-tests its kinds, statuses, events and
 * finding reasons against this file; src/agents.ts exports the same values
 * as TypeScript for SDK consumers.
 *
 * This file pins:
 *   - the closed enums (kind, status, event, ownerless reason);
 *   - the required Agent fields, and that owner_oid / retired_at are nullable;
 *   - that src/agents.ts and the JSON schema agree;
 *   - that hosted-v1.2 in receipt-versions.json still signs agent_id and
 *     owner_oid as OPTIONAL fields (the registry populates them; it does not
 *     make them required, so receipts from paths with no agent still verify).
 *
 * Style copies the gateway test harness: standalone tsx script, manual ok().
 */

import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

let passed = 0, failed = 0
function ok(label: string, cond: boolean, detail?: unknown): void {
  if (cond) { passed++; process.stdout.write(`OK   ${label}\n`) }
  else       { failed++; process.stdout.write(`FAIL ${label}${detail !== undefined ? ' -- ' + JSON.stringify(detail) : ''}\n`) }
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const schemaPath = join(root, 'schemas', 'agent.json')

async function main(): Promise<void> {
  ok('schemas/agent.json exists', existsSync(schemaPath))
  if (!existsSync(schemaPath)) {
    process.stdout.write(`\n${passed} passed, ${failed} failed\n`)
    process.exit(1)
  }
  const s = JSON.parse(readFileSync(schemaPath, 'utf8')) as Record<string, any>
  const defs = (s['$defs'] ?? {}) as Record<string, any>

  ok('$schema is JSON Schema 2020-12', s['$schema'] === 'https://json-schema.org/draft/2020-12/schema', s['$schema'])
  ok('$id names the file', typeof s['$id'] === 'string' && s['$id'].endsWith('/schemas/agent.json'), s['$id'])

  const KINDS = ['claude-code', 'cursor', 'sdk', 'openclaw', 'hermes', 'other']
  ok('AgentKind enum', JSON.stringify(defs['AgentKind']?.enum) === JSON.stringify(KINDS), defs['AgentKind']?.enum)
  ok('AgentStatus enum', JSON.stringify(defs['AgentStatus']?.enum) === JSON.stringify(['active', 'retired']), defs['AgentStatus']?.enum)
  const EVENTS = ['owner_assigned', 'owner_changed', 'retired']
  ok('AgentOwnerEvent.event enum', JSON.stringify(defs['AgentOwnerEvent']?.properties?.event?.enum) === JSON.stringify(EVENTS))
  const REASONS = ['no_owner', 'owner_not_enrolled']
  ok('OwnerlessAgentFinding.reason enum', JSON.stringify(defs['OwnerlessAgentFinding']?.properties?.reason?.enum) === JSON.stringify(REASONS))

  const req = (s['required'] ?? []) as string[]
  const AGENT_REQUIRED = ['agent_id', 'tenant_id', 'name', 'kind', 'owner_oid', 'status', 'created_at', 'retired_at', 'credential_bound']
  ok('Agent required fields', JSON.stringify([...req].sort()) === JSON.stringify([...AGENT_REQUIRED].sort()), req)
  ok('Agent additionalProperties is false', s['additionalProperties'] === false)
  const props = (s['properties'] ?? {}) as Record<string, any>
  ok('agent_id pattern agt_<24 hex>', props['agent_id']?.pattern === '^agt_[0-9a-f]{24}$', props['agent_id'])
  ok('owner_oid is a nullable OID', JSON.stringify(props['owner_oid']?.type) === JSON.stringify(['string', 'null']), props['owner_oid'])
  ok('retired_at is nullable', JSON.stringify(props['retired_at']?.type) === JSON.stringify(['integer', 'null']), props['retired_at'])
  ok('kind refers to AgentKind', props['kind']?.$ref === '#/$defs/AgentKind')
  ok('status refers to AgentStatus', props['status']?.$ref === '#/$defs/AgentStatus')
  ok('no credential material in the Agent shape',
     !Object.keys(props).some(k => /credential_sha|secret|key_hash|token/.test(k)), Object.keys(props))

  const evReq = (defs['AgentOwnerEvent']?.required ?? []) as string[]
  ok('AgentOwnerEvent requires receipt_id, state_json, previous_owner_oid, owner_oid',
     ['receipt_id', 'state_json', 'previous_owner_oid', 'owner_oid', 'event', 'agent_id', 'at'].every(k => evReq.includes(k)), evReq)

  // src/agents.ts agrees with the JSON.
  const mod = await import('../src/agents')
  ok('AGENT_KINDS == schema', JSON.stringify([...mod.AGENT_KINDS]) === JSON.stringify(KINDS))
  ok('AGENT_STATUSES == schema', JSON.stringify([...mod.AGENT_STATUSES]) === JSON.stringify(['active', 'retired']))
  ok('AGENT_EVENTS == schema', JSON.stringify([...mod.AGENT_EVENTS]) === JSON.stringify(EVENTS))
  ok('OWNERLESS_REASONS == schema', JSON.stringify([...mod.OWNERLESS_REASONS]) === JSON.stringify(REASONS))
  ok('isAgentKind', mod.isAgentKind('cursor') && !mod.isAgentKind('robot') && !mod.isAgentKind(undefined))
  const idx = await import('../src/index')
  ok('index re-exports AGENT_KINDS', JSON.stringify([...(idx as any).AGENT_KINDS ?? []]) === JSON.stringify(KINDS))

  // receipt-versions.json: agent_id / owner_oid stay optional in hosted-v1.2.
  const rv = JSON.parse(readFileSync(join(root, 'schemas', 'receipt-versions.json'), 'utf8')) as {
    versions: Array<{ id: string; required_fields: string[]; optional_fields: string[] }>
  }
  const v12 = rv.versions.find(v => v.id === 'hosted-v1.2')
  ok('hosted-v1.2 signs agent_id + owner_oid as optional',
     !!v12 && v12.optional_fields.includes('agent_id') && v12.optional_fields.includes('owner_oid') &&
     !v12.required_fields.includes('agent_id') && !v12.required_fields.includes('owner_oid'))

  process.stdout.write(`\n${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exit(1)
}

main().catch(e => { process.stdout.write(`FAIL threw: ${(e as Error).message}\n`); process.exit(1) })
