/**
 * test/types.test.ts -- type-level + structural round-trip checks.
 *
 * These tests verify:
 *   1. ChannelKind has exhaustive coverage for the canonical literals
 *      (a function switching on every canonical kind compiles).
 *   2. GapCdroEnvelope shapes survive a structural round trip
 *      (build -> JSON.stringify -> JSON.parse -> typeof check).
 *   3. capabilityMatches behaves per spec (exact + wildcard).
 */

import {
  capabilityMatches,
  CANONICAL_CHANNEL_KINDS,
  type CanonicalChannelKind,
  type CapabilityDeclaration,
} from '../src/index.js'

let passed = 0, failed = 0
function ok(label: string, cond: boolean, detail?: string): void {
  if (cond) { passed++; process.stdout.write(`OK   ${label}\n`) }
  else      { failed++; process.stdout.write(`FAIL ${label}${detail ? ' - ' + detail : ''}\n`) }
}

// 1. Exhaustive switch on CanonicalChannelKind
function describeCanonicalChannel(k: CanonicalChannelKind): string {
  switch (k) {
    case 'sms':                 return 'SMS'
    case 'voice':               return 'Voice call'
    case 'email':               return 'Email'
    case 'slack':               return 'Slack DM'
    case 'mobile_push':         return 'Mobile push'
    case 'sse':                 return 'Server-Sent Events'
    case 'webhook':             return 'Webhook'
    case 'in_app':              return 'In-app'
    case 'game_engine':         return 'Game engine'
    case 'home_assistant':      return 'Home Assistant'
    case 'desktop_overlay':     return 'Desktop overlay'
    case 'local_terminal':      return 'Local terminal (air-gapped)'
    case 'hmi_panel':           return 'HMI panel (air-gapped)'
    case 'opc_ua_ack':          return 'OPC-UA acknowledgement (air-gapped)'
    case 'local_signed_token':  return 'Local signed token (air-gapped)'
  }
}

ok('CanonicalChannelKind exhaustive switch compiles + runs',
   CANONICAL_CHANNEL_KINDS.every((k) => describeCanonicalChannel(k).length > 0))

ok('CANONICAL_CHANNEL_KINDS has 15 entries',
   CANONICAL_CHANNEL_KINDS.length === 15)

// 2. Round trip
const decl: CapabilityDeclaration = {
  oid: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
  type: 'gap:capability_declaration',
  gap_version: '1.0',
  tenant_id: 'tenant-test',
  created_at_ms: 1700000000000,
  created_by: 'actor:operator',
  body: {
    actor_type: 'skill',
    actor_id: 'skill:demo',
    actor_name: 'Demo',
    actor_version: '1.0.0',
    capabilities: [{ capability: 'demo.say_hello' }],
  },
}
const parsed = JSON.parse(JSON.stringify(decl)) as CapabilityDeclaration
ok('CapabilityDeclaration round-trips through JSON',
   parsed.oid === decl.oid
   && parsed.type === decl.type
   && parsed.gap_version === decl.gap_version
   && parsed.tenant_id === decl.tenant_id
   && parsed.body.actor_id === decl.body.actor_id
   && parsed.body.capabilities.length === 1
   && parsed.body.capabilities[0]?.capability === 'demo.say_hello')

// 3. capabilityMatches
ok('capabilityMatches: exact match',         capabilityMatches('skill.create', 'skill.create'))
ok('capabilityMatches: wildcard match',      capabilityMatches('skill.*', 'skill.create'))
ok('capabilityMatches: wildcard non-match',  !capabilityMatches('skill.*', 'agent.create'))
ok('capabilityMatches: lone star',           capabilityMatches('*', 'anything.at.all'))
ok('capabilityMatches: empty target',        !capabilityMatches('skill.create', ''))
ok('capabilityMatches: prefix without star is exact',
   !capabilityMatches('skill', 'skill.create'))

process.stdout.write(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed > 0 ? 1 : 0)
