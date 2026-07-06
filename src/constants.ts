/**
 * constants.ts -- well-known capability OIDs + channel kinds.
 *
 * Reserved OID strings for the GAP platform. These identifiers are stable
 * across all conforming gateway implementations. Third-party implementations
 * MUST NOT redefine them.
 *
 *   - DISCOVERY_QUERY_CAPABILITY   reserved for /by-grant discovery queries
 *   - SKILL_CREATE_CAPABILITY      reserved for skill manifest upload
 *   - VOICE_JOIN_CAPABILITY        reserved for voice bridge authorization
 */

import type { CanonicalChannelKind } from './channels.js'

// -- Well-known capability names (dotted taxonomy) ---------------------------

/** Capability that authorizes /by-grant discovery queries. */
export const DISCOVERY_QUERY_CAPABILITY = 'gap.discovery.query' as const

/** Capability that authorizes skill creation (skill manifest upload). */
export const SKILL_CREATE_CAPABILITY = 'skill.create' as const

/** Capability that authorizes joining a voice bridge call. */
export const VOICE_JOIN_CAPABILITY = 'gap.voice.join' as const

/** All well-known capability names, useful for tests + audit dashboards. */
export const WELL_KNOWN_CAPABILITIES = [
  DISCOVERY_QUERY_CAPABILITY,
  SKILL_CREATE_CAPABILITY,
  VOICE_JOIN_CAPABILITY,
] as const

export type WellKnownCapability = typeof WELL_KNOWN_CAPABILITIES[number]

// -- Channel kind constants (mirror canonical list) --------------------------

export const CHANNEL_VOICE: CanonicalChannelKind = 'voice'
export const CHANNEL_SMS: CanonicalChannelKind = 'sms'
export const CHANNEL_SLACK: CanonicalChannelKind = 'slack'
export const CHANNEL_MOBILE_PUSH: CanonicalChannelKind = 'mobile_push'
export const CHANNEL_HOME_ASSISTANT: CanonicalChannelKind = 'home_assistant'
export const CHANNEL_DESKTOP_OVERLAY: CanonicalChannelKind = 'desktop_overlay'
export const CHANNEL_EMAIL: CanonicalChannelKind = 'email'
export const CHANNEL_IN_APP: CanonicalChannelKind = 'in_app'
export const CHANNEL_GAME_ENGINE: CanonicalChannelKind = 'game_engine'
export const CHANNEL_WEBHOOK: CanonicalChannelKind = 'webhook'
