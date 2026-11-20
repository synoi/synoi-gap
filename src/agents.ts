/**
 * agents.ts -- the agent + owner registry shape (schemas/agent.json).
 *
 * A registered AI agent names one accountable owner: a person, identified by
 * an operator OID enrolled for the same tenant. A gateway signs that agent_id
 * and owner_oid into its hosted-v1.2 Decision Receipts (both OPTIONAL signed
 * fields in schemas/receipt-versions.json), and receipts every owner event.
 *
 * The values here equal schemas/agent.json; test/agent-schema.test.ts pins it.
 */

export const AGENT_KINDS = ['claude-code', 'cursor', 'sdk', 'openclaw', 'hermes', 'other'] as const
export type AgentKind = (typeof AGENT_KINDS)[number]

export const AGENT_STATUSES = ['active', 'retired'] as const
export type AgentStatus = (typeof AGENT_STATUSES)[number]

export const AGENT_EVENTS = ['owner_assigned', 'owner_changed', 'retired'] as const
export type AgentEventKind = (typeof AGENT_EVENTS)[number]

export const OWNERLESS_REASONS = ['no_owner', 'owner_not_enrolled'] as const
export type OwnerlessReason = (typeof OWNERLESS_REASONS)[number]

export function isAgentKind(v: unknown): v is AgentKind {
  return typeof v === 'string' && (AGENT_KINDS as readonly string[]).includes(v)
}

export interface Agent {
  /** `agt_` + 24 lowercase hex; gateway-issued, never reused. */
  agent_id:         string
  tenant_id:        string
  name:             string
  kind:             AgentKind
  /** The accountable person; null = no owner yet. */
  owner_oid:        string | null
  status:           AgentStatus
  /** Unix ms. */
  created_at:       number
  updated_at?:      number
  retired_at:       number | null
  /** A gateway credential is bound, so this agent's receipts carry agent_id / owner_oid. */
  credential_bound: boolean
}

export interface AgentOwnerEvent {
  event:              AgentEventKind
  agent_id:           string
  tenant_id:          string
  previous_owner_oid: string | null
  owner_oid:          string | null
  at:                 number
  /** The signed receipt for this event; null only if signing failed. */
  receipt_id:         string | null
  /** The receipt's signed state_sha256 is sha256(state_json). */
  state_json:         string
}

export interface OwnerlessAgentFinding {
  agent_id:   string
  tenant_id:  string
  name:       string
  kind:       AgentKind
  owner_oid:  string | null
  reason:     OwnerlessReason
  created_at: number
}
