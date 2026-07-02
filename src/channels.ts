/**
 * channels.ts -- channel taxonomy + adapter interface.
 *
 * Channels bridge GAP's abstract `actions`/`listen` model to concrete
 * delivery surfaces (SMS, mobile push, home assistant, etc.).
 *
 * This file declares only the TYPES. Adapter implementations live in
 * downstream packages (the gateway, vendor SDKs). The interface here is the
 * contract those implementations satisfy.
 */

import type { GapCdroEnvelope } from './cdro.js'
import type { MeasuredResult } from './receipts.js'

/** Built-in channel kinds. The `(string & {})` branch keeps the union open
 *  for vendor-specific extensions (e.g. 'com.example.pager') while
 *  preserving autocomplete on the canonical entries.
 *
 *  Connectivity categories:
 *   Internet:     sms, voice, email, slack, mobile_push
 *   LAN/Internet: sse, webhook
 *   Local:        in_app, game_engine, home_assistant, desktop_overlay
 *   Air-gapped:   local_terminal, hmi_panel, opc_ua_ack, local_signed_token
 */
export type ChannelKind =
  // Internet channels
  | 'sms'
  | 'voice'
  | 'email'
  | 'slack'
  | 'mobile_push'
  // LAN/Internet channels
  | 'sse'
  | 'webhook'
  // Local channels
  | 'in_app'
  | 'game_engine'
  | 'home_assistant'
  | 'desktop_overlay'
  // Air-gapped / local enforcement point channels
  | 'local_terminal'
  | 'hmi_panel'
  | 'opc_ua_ack'
  | 'local_signed_token'
  // Extensible for custom adapters; use reverse-domain prefix e.g. 'com.example.pager'
  | (string & {})

/** Subset of ChannelKind containing only the canonical (literal) values.
 *  Useful for exhaustive switches in code that only handles built-ins. */
export type CanonicalChannelKind =
  | 'sms'
  | 'voice'
  | 'email'
  | 'slack'
  | 'mobile_push'
  | 'sse'
  | 'webhook'
  | 'in_app'
  | 'game_engine'
  | 'home_assistant'
  | 'desktop_overlay'
  | 'local_terminal'
  | 'hmi_panel'
  | 'opc_ua_ack'
  | 'local_signed_token'

/** Ordered list of canonical channels, useful for menu UIs + tests. */
export const CANONICAL_CHANNEL_KINDS: readonly CanonicalChannelKind[] = [
  'sms',
  'voice',
  'email',
  'slack',
  'mobile_push',
  'sse',
  'webhook',
  'in_app',
  'game_engine',
  'home_assistant',
  'desktop_overlay',
  'local_terminal',
  'hmi_panel',
  'opc_ua_ack',
  'local_signed_token',
] as const

// -- Stage primitives that reference channels --------------------------------

export interface StageAction {
  channel: ChannelKind
  method: string
  params: Record<string, unknown>
}

export interface StageTransitionTarget {
  next_stage_id?: string
  bind?: Record<string, string>
}

export interface StageListen {
  channel: ChannelKind
  intent?: string
  pattern?: string
  event_kind?: string
  next: StageTransitionTarget
  /**
   * When set, the gateway MUST verify that the channel event's `from` field
   * matches this value before accepting it as a valid stage signal. For SMS
   * channels this is the operator's registered phone number (E.164 format).
   * For webhook channels this is the expected sender identity string.
   *
   * Required for stages that govern physical_safety=true or safety_class C
   * capabilities. Absent means no sender-identity check is performed.
   */
  required_from_binding?: string
}

// -- ChannelEvent CDRO -------------------------------------------------------

export interface ChannelEventBody {
  channel: ChannelKind
  event_kind: string
  payload: Record<string, unknown>
  observed_at_ms: number
  /** Workflow context if this event originated from / is routed to a workflow. */
  workflow_instance_oid?: string
  stage_id?: string
}

export type ChannelEvent = GapCdroEnvelope<ChannelEventBody>

// -- ChannelAdapter interface ------------------------------------------------

export interface AdapterContext {
  tenant_id: string
  workflow_instance_oid: string
  stage_id: string
  scope_variables: Record<string, unknown>
}

export interface ActionResult {
  ok: boolean
  detail?: string
  /** OID of a channel event spawned by the action, if any. */
  spawned_event_oid?: string
  /**
   * [0024] measured result block. Optional, backward compatible: every
   * shipped adapter that does not set it remains valid. Populated by an
   * adapter's `performAction` once the provider call has actually returned,
   * so it records what happened, not what was quoted. The synchronous
   * execute-and-await invoke path (Instagration prereq 0) reads this field
   * and binds it into the signed `GapDecisionReceiptBody.measured` block
   * (`receipts.ts`) so measured cost/result/counterparty enter the signed
   * content core, not just the transient adapter response.
   */
  measured?: MeasuredResult
}

export interface ListenHandle {
  cancel(): void
}

/**
 * Interface that every channel adapter must implement. Adapter
 * implementations are out of scope for this types package -- they live in
 * synoi-gateway and downstream packages.
 */
export interface ChannelAdapter {
  /** Channel kind this adapter handles. */
  kind: ChannelKind

  /** Adapter capabilities -- which GAP listen/action shapes it supports. */
  supports: {
    actions: string[]
    listens: Array<'intent' | 'pattern' | 'event_kind'>
  }

  /** Execute an action. Returns when complete or errors. */
  performAction(spec: StageAction, context: AdapterContext): Promise<ActionResult>

  /** Arm a listener. Returns a handle that can be cancelled. */
  armListen(
    spec: StageListen,
    context: AdapterContext,
    onMatch: (event: ChannelEvent) => void,
  ): ListenHandle

  /** Health check. */
  health(): Promise<{ ok: boolean; detail?: string }>
}

export interface ChannelRegistry {
  register(adapter: ChannelAdapter): void
  get(kind: ChannelKind): ChannelAdapter | null
  list(): ChannelAdapter[]
}
