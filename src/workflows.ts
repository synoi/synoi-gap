/**
 * workflows.ts -- WorkflowDefinition / WorkflowInstance / StageTransition.
 *
 * Workflows choreograph the HITL flow when a capability invocation requires
 * human approval (or any orchestrated multi-stage interaction). Shapes
 * mirror the GAP wire types.
 *
 * State model:
 *   - WorkflowDefinition is a static template.
 *   - WorkflowInstance is a single live run.
 *   - StageTransition is the audited edge between two stages of an instance.
 */

import type { GapCdroEnvelope } from './cdro.js'
import type { CapabilityPredicate } from './capabilities.js'
import type {
  ChannelKind,
  StageAction,
  StageListen,
  StageTransitionTarget,
} from './channels.js'

// -- Optional ambient effect -------------------------------------------------

/**
 * Optional ambient effect -- fires if the operator's environment has a
 * matching declared+granted capability, silently skipped if not. See
 * OPTIONAL_CAPABILITIES_SPEC.md for the full design.
 *
 * The match algorithm:
 *   1. Resolve `requires_capability` against gap:capability_declaration
 *      records that are (a) not revoked, (b) granted to this workflow's
 *      invoking actor, (c) visible per the operator's sharing policy.
 *   2. If zero matches -> skip silently.
 *   3. If >=1 match -> fire the action through the named channel.
 *   4. Failures of optional_effects DO NOT propagate to stage outcome.
 *      They're best-effort by definition.
 */
export interface OptionalEffect {
  /** Capability the effect needs in the environment to fire. Supports
      dotted-taxonomy wildcards: 'home.lighting.*' matches any lighting
      capability the operator's smart home has declared. */
  requires_capability: string
  /** The action to perform when the capability is matched. */
  action: StageAction
  /** Optional human-readable label for audit logs + portal UI. */
  label?: string
}

// -- Stage safety wrapper (CI/CD governance net) -----------------------------

/**
 * CI/CD safety net (see SYNOI_CICD_GOVERNANCE_SPEC.md §10.5). When set,
 * the engine routes the stage's invocation through runSafetyPipeline:
 *   snapshot -> two-person -> cooldown -> invoke -> record.
 * All four sub-pieces are independently optional. Absent => default
 * behaviour (no safety wrapping; existing GAP semantics).
 */
export interface StageSafety {
  /** Marker -- set when this stage performs a destructive operation.
   *  Required for the safety wrapper to engage. */
  destructive: true
  /** Resource kind for snapshot routing. Engine picks the adapter by kind. */
  resource_kind?:
    | 'postgres_db'
    | 'mysql_db'
    | 'aws_rds_instance'
    | 'aws_ebs_volume'
    | 'aws_s3_object_versioned'
    | 'k8s_namespace_velero'
    | 'terraform_state'
    | 'git_branch'
    | 'filesystem_path'
  /** Override adapter name. If unset, engine picks the first registered
   *  adapter for resource_kind. */
  snapshot_adapter?: string
  /** Resource id passed to adapter.capture() -- usually interpolated. */
  snapshot_resource_id?: string
  /** Adapter config (interpolated). */
  snapshot_config?: Record<string, string>
  /** Two-person rule config. Pass null/undefined to skip. */
  two_person?: {
    required: number
    require_disjoint_groups?: boolean
    eligible_groups?: string[]
  }
  /** Cooldown window in milliseconds. 0/undefined => skip. */
  cooldown_ms?: number
  /** Approver-groups that can cancel the cooldown. */
  cooldown_eligible_groups?: string[]
  /** Optional OID of the paired rollback workflow. */
  rollback_workflow_oid?: string
}

// -- Stage shape -------------------------------------------------------------

export interface WorkflowStage {
  stage_id: string
  duration_seconds?: number
  actions?: StageAction[]
  /** Optional ambient effects -- fire if matching capabilities exist; skip
      silently otherwise. Independent of the mandatory `actions` list. */
  optional_effects?: OptionalEffect[]
  /**
   * Actor OIDs permitted to supply valid approval signals for this stage.
   * When set, the gateway MUST verify that the approver's authenticated identity
   * resolves to one of these OIDs before advancing the stage on a YES signal.
   * The gateway MUST enforce actor_oid disjointness: the same actor_oid cannot
   * count as more than one approval (prevents one person approving twice).
   *
   * MUST be set for stages governing physical_safety=true or safety_class C
   * capabilities. Absent means any tenant-authenticated signal is accepted
   * (dangerous; use only for class A/B capabilities).
   */
  authorized_approvers?: string[]
  listen?: StageListen[]
  /**
   * Stage to transition to when the stage timer expires.
   *
   * WARNING: For workflow definitions whose trigger matches a
   * physical_safety=true or safety_class C capability, `on_timeout` MUST NOT
   * lead to a terminal stage with `terminal_outcome='approved'`. The gateway
   * MUST reject such definitions at registration time (PC-11).
   */
  on_timeout?: StageTransitionTarget
  on_action_failure?: StageTransitionTarget
  terminal?: boolean
  terminal_outcome?: 'approved' | 'denied' | 'timed_out' | 'withdrawn' | 'error'
  invocation?: {
    capability: string
    args: Record<string, unknown>
    on_success?: StageTransitionTarget
    on_failure?: StageTransitionTarget
  }
  precondition?: CapabilityPredicate
  safety?: StageSafety
}

/** Alias used in the spec docs + spec discussion. WorkflowStage is the
 *  authoritative shape; this alias makes the engine API readable. */
export type WorkflowStageDefinition = WorkflowStage

// -- Triggers ----------------------------------------------------------------

export type WorkflowTriggerKind =
  | 'risk_policy'
  | 'capability_invocation'
  | 'explicit'
  | 'schedule'

export interface WorkflowTrigger {
  kind: WorkflowTriggerKind
  risk_class?: 'A' | 'B' | 'C'
  action_class?: string
  action_type_pattern?: string
  capability_pattern?: string
  cron?: string
}

// -- Definition CDRO ---------------------------------------------------------

export interface WorkflowDefinitionBody {
  workflow_id: string
  workflow_name: string
  workflow_version: string
  description?: string
  trigger: WorkflowTrigger
  stages: WorkflowStage[]
  initial_stage_id: string
  cleanup_stage_id?: string
  required_channels: ChannelKind[]
  optional_channels?: ChannelKind[]
  max_total_duration_seconds: number
  /**
   * When true, this workflow definition (and any supersession of it) requires
   * operator-level authorization before it becomes active. The registration
   * request must carry the operator's signed attestation. MUST be true for
   * definitions whose `trigger.capability_pattern` matches any
   * physical_safety=true capability. The gateway MUST reject registration of
   * unsafe (on_timeout->approved) paths for physical safety patterns.
   */
  requires_operator_approval?: boolean
}

export type WorkflowDefinition = GapCdroEnvelope<WorkflowDefinitionBody>

// -- Instance CDRO -----------------------------------------------------------

export interface WorkflowInstanceBody {
  workflow_definition_oid: string
  workflow_id: string
  trigger_event: {
    kind: WorkflowTriggerKind
    source_invocation_oid?: string
    source_risk_policy_id?: string
    source_actor_oid: string
  }
  current_stage_id: string
  scope_variables: Record<string, unknown>
  started_at_ms: number
  last_transition_at_ms: number
  terminated_at_ms: number | null
  terminal_outcome: WorkflowStage['terminal_outcome'] | null
  active_channel_listeners: Array<{
    channel: ChannelKind
    listen_spec: StageListen
    started_at_ms: number
  }>
  transition_oids: string[]
  final_receipt_oid?: string
}

export type WorkflowInstance = GapCdroEnvelope<WorkflowInstanceBody>

// -- Stage transition CDRO ---------------------------------------------------

export type StageTransitionReason =
  | 'listen_matched'
  | 'timeout'
  | 'action_completed'
  | 'action_failed'
  | 'precondition_passed'
  | 'precondition_failed'
  | 'invocation_succeeded'
  | 'invocation_failed'
  | 'external_signal'
  | 'cleanup'

export interface StageTransitionBody {
  workflow_instance_oid: string
  previous_transition_oid: string | null
  from_stage_id: string
  to_stage_id: string
  trigger_reason: StageTransitionReason
  bind_outputs: Record<string, unknown>
  triggering_event_oid?: string
  triggering_invocation_oid?: string
  transitioned_at_ms: number
}

export type StageTransition = GapCdroEnvelope<StageTransitionBody>
