/**
 * @synoi/gap -- public surface.
 *
 * Apache-2.0 TypeScript types + runtime validators for SynOI's
 * GAP (Governed Action Protocol).
 *
 * The protocol itself is open under CC0; this package ships the wire-format
 * types so any GAP implementation (third-party gateway, audit tool, vendor
 * SDK) can speak the same wire format from a single source of truth.
 */

// -- CDRO envelope -----------------------------------------------------------
export {
  GAP_VERSION,
} from './cdro.js'
export type {
  GapCdroEnvelope,
  GapObjectType,
  GapOidPayload,
  GapVersion,
} from './cdro.js'

// -- Capabilities (declarations, grants, invocations) ------------------------
export {
  capabilityMatches,
} from './capabilities.js'
export type {
  GapActorType,
  Capability,
  CapabilityDeclaration,
  CapabilityDeclarationBody,
  CapabilityGrant,
  CapabilityGrantBody,
  CapabilityInvocation,
  CapabilityInvocationBody,
  CapabilityPredicate,
  GrantedCapabilityScope,
  // Item 1: Agent Delegation Chain
  DelegationStep,
  OrchestrationChainBody,
  // Item 2: MCP Tool-Call Governance
  McpToolCallContext,
  // Item 3: Token Budget Governance
  TokenBudgetArgs,
  // Item 4: Consent Version Chain
  ConsentRecordBody,
  // Item 5: Identity Binding
  CredentialKind,
  IdentityBinding,
  // Item 6: Compartment-Based Access Scoping (fields added to existing types)
  // Item 7: Signed PIP Response
  ExternalPipArgs,
  PipResponseBody,
} from './capabilities.js'

// -- Channels ----------------------------------------------------------------
export {
  CANONICAL_CHANNEL_KINDS,
} from './channels.js'
export type {
  ActionResult,
  AdapterContext,
  CanonicalChannelKind,
  ChannelAdapter,
  ChannelEvent,
  ChannelEventBody,
  ChannelKind,
  ChannelRegistry,
  ListenHandle,
  StageAction,
  StageListen,
  StageTransitionTarget,
} from './channels.js'

// -- Workflows ---------------------------------------------------------------
export type {
  OptionalEffect,
  StageSafety,
  StageTransition,
  StageTransitionBody,
  StageTransitionReason,
  WorkflowDefinition,
  WorkflowDefinitionBody,
  WorkflowInstance,
  WorkflowInstanceBody,
  WorkflowStage,
  WorkflowStageDefinition,
  WorkflowTrigger,
  WorkflowTriggerKind,
} from './workflows.js'

// -- Receipts + failures -----------------------------------------------------
export {
  isGapFailure,
} from './receipts.js'
export type {
  GapDecisionReceipt,
  GapDecisionReceiptBody,
  GapFailure,
  GapFailureReason,
  DecisionStatus,
  DecisionSubjectKind,
  // Item 3: Token Budget Governance
  TokenConsumption,
} from './receipts.js'

// -- Revocations -------------------------------------------------------------
export {
  revokeGapObject,
} from './revocations.js'
export type {
  RevocationEvent,
  RevocationEventBody,
  RevocationTargetKind,
} from './revocations.js'

// -- Constants ---------------------------------------------------------------
export {
  CHANNEL_DESKTOP_OVERLAY,
  CHANNEL_EMAIL,
  CHANNEL_GAME_ENGINE,
  CHANNEL_HOME_ASSISTANT,
  CHANNEL_IN_APP,
  CHANNEL_MOBILE_PUSH,
  CHANNEL_SLACK,
  CHANNEL_SMS,
  CHANNEL_VOICE,
  CHANNEL_WEBHOOK,
  DISCOVERY_QUERY_CAPABILITY,
  SKILL_CREATE_CAPABILITY,
  VOICE_JOIN_CAPABILITY,
  WELL_KNOWN_CAPABILITIES,
} from './constants.js'
export type {
  WellKnownCapability,
} from './constants.js'

// -- OID + canonicalize ------------------------------------------------------
export {
  computeGapOid,
} from './oid.js'
export {
  canonicalize,
} from './canonicalize.js'

// -- Validators --------------------------------------------------------------
export type {
  ValidationResult,
} from './validate.js'
export {
  validateGapDecisionReceipt,
  validateGapDecisionReceiptBody,
  validateCapabilityDeclaration,
  validateCapabilityDeclarationBody,
  validateCapabilityGrant,
  validateCapabilityGrantBody,
  validateCapabilityInvocation,
  validateCapabilityInvocationBody,
  validateChannelEvent,
  validateChannelEventBody,
  validateRevocationEvent,
  validateRevocationEventBody,
  validateStageTransition,
  validateStageTransitionBody,
  validateWorkflowDefinition,
  validateWorkflowDefinitionBody,
  validateWorkflowInstance,
  validateWorkflowInstanceBody,
  // Item 1: Agent Delegation Chain
  validateOrchestrationChainBody,
  validateOrchestrationChain,
  // Item 3: Token Budget Governance
  validateTokenConsumption,
  // Item 4: Consent Version Chain
  validateConsentRecordBody,
  validateConsentRecord,
  // Item 7: Signed PIP Response
  validatePipResponseBody,
  validatePipResponse,
} from './validate.js'
