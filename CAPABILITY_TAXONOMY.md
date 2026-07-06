# GAP Capability Taxonomy

Canonical dotted-taxonomy names for well-known capabilities. Independent GAP
implementations that use these names will interoperate without custom mapping.

Custom capabilities may use any prefix not listed here. Vendors SHOULD use a
reverse-domain prefix (for example: `com.example.myapp.custom_action`).

---

## Safety class conventions

- `A`: read-only or reversible, no physical consequence
- `B`: state-changing, recoverable
- `C`: physical-safety-critical, irreversible, or life-affecting

The `physical_safety` column indicates whether the capability can change
physical-world state in a way that could affect human safety. Gateways treat
`physical_safety: true` as a hard signal: grants covering these capabilities
default to L3 revocation, and `on_timeout -> approved` workflow paths are
rejected at definition registration time.

---

## home.* (Smart home / consumer IoT)

| Capability | safety_class | physical_safety | Args (key: type) | Description |
|---|---|---|---|---|
| `home.lighting.dim` | B | false | `room: string`, `brightness_pct: number (0-100)` | Set room brightness to a target level |
| `home.lighting.on` | B | false | `room: string` | Turn on lights in a room |
| `home.lighting.off` | B | false | `room: string` | Turn off lights in a room |
| `home.lighting.color` | B | false | `room: string`, `color_hex: string` | Set light color |
| `home.lighting.read` | A | false | `room: string` | Read current brightness and state |
| `home.lock.engage` | C | true | `door_id: string` | Lock a door |
| `home.lock.disengage` | C | true | `door_id: string` | Unlock a door |
| `home.lock.status` | A | false | `door_id: string` | Read lock state |
| `home.alarm.arm` | C | true | `zone_id: string`, `mode: string ("home"\|"away"\|"night")` | Arm alarm system |
| `home.alarm.disarm` | C | true | `zone_id: string` | Disarm alarm system |
| `home.alarm.status` | A | false | `zone_id: string` | Read alarm state |
| `home.thermostat.set` | B | false | `zone_id: string`, `target_temp_c: number` | Set thermostat target temperature |
| `home.thermostat.read` | A | false | `zone_id: string` | Read thermostat state and current temperature |
| `home.sensor.read` | A | false | `sensor_id: string` | Read a sensor value (motion, contact, humidity, etc.) |
| `home.audio.play` | B | false | `zone_id: string`, `track: string`, `volume: number (0-100)` | Play audio in a zone |
| `home.audio.stop` | B | false | `zone_id: string` | Stop audio in a zone |
| `home.camera.snapshot` | A | false | `camera_id: string` | Capture a still image |
| `home.garage.open` | C | true | `door_id: string` | Open a garage door |
| `home.garage.close` | C | true | `door_id: string` | Close a garage door |
| `home.garage.status` | A | false | `door_id: string` | Read garage door state |

---

## industrial.* (Industrial automation / OT / SCADA)

All `industrial.*` capabilities with `physical_safety: true` require an L4
gateway for authorized-axis audit (IEC 62443 SR 2.8). Operators MUST set
`provisional_block_policy.on_expiry_without_quorum = 'renew'` on grants for
these capabilities.

| Capability | safety_class | physical_safety | Args (key: type) | Description |
|---|---|---|---|---|
| `industrial.valve.open` | C | true | `asset_id: string`, `open_pct: number (0-100)` | Open a valve to a target percentage |
| `industrial.valve.close` | C | true | `asset_id: string` | Close a valve fully |
| `industrial.valve.set` | C | true | `asset_id: string`, `open_pct: number (0-100)` | Set valve to an exact position |
| `industrial.valve.status` | A | false | `asset_id: string` | Read valve position and state |
| `industrial.pump.start` | C | true | `asset_id: string` | Start a pump |
| `industrial.pump.stop` | C | true | `asset_id: string` | Stop a pump |
| `industrial.pump.set-speed` | C | true | `asset_id: string`, `speed_rpm: number` | Set pump speed |
| `industrial.pump.status` | A | false | `asset_id: string` | Read pump speed and state |
| `industrial.motor.start` | C | true | `asset_id: string` | Start a motor |
| `industrial.motor.stop` | C | true | `asset_id: string` | Stop a motor |
| `industrial.motor.set-speed` | C | true | `asset_id: string`, `speed_pct: number (0-100)` | Set motor speed as a percentage of rated |
| `industrial.motor.status` | A | false | `asset_id: string` | Read motor speed and state |
| `industrial.plc.write-coil` | C | true | `asset_id: string`, `coil_address: number`, `value: boolean` | Write a discrete output coil on a PLC |
| `industrial.plc.write-register` | C | true | `asset_id: string`, `register_address: number`, `value: number` | Write a holding register on a PLC |
| `industrial.plc.read-coil` | A | false | `asset_id: string`, `coil_address: number` | Read a discrete input/output coil |
| `industrial.plc.read-register` | A | false | `asset_id: string`, `register_address: number` | Read a holding register |
| `industrial.sensor.read` | A | false | `sensor_id: string` | Read a sensor value (pressure, temperature, flow, level) |
| `industrial.sensor.calibrate` | B | false | `sensor_id: string`, `reference_value: number` | Calibrate a sensor against a reference |
| `industrial.conveyor.start` | C | true | `asset_id: string` | Start a conveyor belt |
| `industrial.conveyor.stop` | C | true | `asset_id: string` | Stop a conveyor belt |
| `industrial.conveyor.set-speed` | C | true | `asset_id: string`, `speed_mps: number` | Set conveyor speed in meters per second |
| `industrial.heater.set` | C | true | `asset_id: string`, `target_temp_c: number` | Set heater target temperature |
| `industrial.heater.off` | C | true | `asset_id: string` | Turn off a heater |
| `industrial.alarm.acknowledge` | B | false | `alarm_id: string`, `operator_note: string` | Acknowledge an active alarm |
| `industrial.alarm.suppress` | C | true | `alarm_id: string`, `reason: string`, `duration_s: number` | Temporarily suppress an alarm |
| `industrial.estop.trigger` | C | true | `zone_id: string`, `reason: string` | Trigger an emergency stop for a zone |
| `industrial.estop.reset` | C | true | `zone_id: string` | Reset an emergency stop (requires human verification first) |

---

## medical.* (Healthcare and medical devices)

All `medical.*` capabilities with `physical_safety: true` require L4 gateway
conformance for 21 CFR Part 11 compliance. Grants for these capabilities MUST
carry `evidence_oids` referencing the authorizing physician's prescription or
order CDRO and the patient's consent CDRO.

| Capability | safety_class | physical_safety | Args (key: type) | Description |
|---|---|---|---|---|
| `medical.device.read-telemetry` | A | false | `device_id: string` | Read real-time telemetry from a medical device |
| `medical.device.adjust-dose` | C | true | `device_id: string`, `delta_units: number`, `rationale: string` | Adjust medication dose on an infusion pump or similar device |
| `medical.device.set-rate` | C | true | `device_id: string`, `rate_units_per_hr: number`, `rationale: string` | Set delivery rate on an infusion pump |
| `medical.device.pause` | C | true | `device_id: string`, `reason: string` | Pause medication delivery |
| `medical.device.resume` | C | true | `device_id: string` | Resume medication delivery after a pause |
| `medical.glucose.read` | A | false | `patient_id: string` | Read continuous glucose monitor value |
| `medical.glucose.calibrate` | B | false | `patient_id: string`, `reference_mg_dl: number` | Submit a calibration reading |
| `medical.ventilator.set-rate` | C | true | `device_id: string`, `breaths_per_min: number`, `rationale: string` | Set ventilator respiratory rate |
| `medical.ventilator.set-fio2` | C | true | `device_id: string`, `fio2_pct: number (21-100)`, `rationale: string` | Set fraction of inspired oxygen |
| `medical.ventilator.set-peep` | C | true | `device_id: string`, `peep_cmh2o: number`, `rationale: string` | Set positive end-expiratory pressure |
| `medical.ventilator.read` | A | false | `device_id: string` | Read current ventilator settings and waveforms |
| `medical.alert.create` | B | false | `patient_id: string`, `severity: string ("info"\|"warning"\|"critical")`, `message: string` | Create a clinical alert for care team |
| `medical.alert.acknowledge` | B | false | `alert_id: string`, `responder_id: string`, `note: string` | Acknowledge a clinical alert |
| `medical.record.read` | A | false | `patient_id: string`, `record_type: string` | Read a patient record segment (subject to PHI policy) |
| `medical.record.annotate` | B | false | `patient_id: string`, `record_id: string`, `annotation: string` | Add a clinical annotation to a record |
| `medical.order.create` | C | true | `patient_id: string`, `order_type: string`, `details: object` | Create a clinical order (requires physician grant) |

---

## physical.* (Physical security and access control)

| Capability | safety_class | physical_safety | Args (key: type) | Description |
|---|---|---|---|---|
| `physical.access.grant-temporary` | C | true | `zone_id: string`, `actor_id: string`, `expires_at_ms: number` | Issue a temporary access credential for a zone |
| `physical.access.revoke` | C | true | `zone_id: string`, `actor_id: string`, `reason: string` | Revoke access for an actor in a zone |
| `physical.access.read-log` | A | false | `zone_id: string`, `from_ms: number`, `to_ms: number` | Read access event log for a zone |
| `physical.badge.issue` | C | true | `actor_id: string`, `access_zones: string[]` | Issue a physical badge with zone access |
| `physical.badge.revoke` | C | true | `badge_id: string`, `reason: string` | Revoke a physical badge |
| `physical.camera.live` | A | false | `camera_id: string` | Access live camera feed |
| `physical.camera.snapshot` | A | false | `camera_id: string` | Capture a still frame from a camera |
| `physical.camera.ptz` | B | false | `camera_id: string`, `pan: number`, `tilt: number`, `zoom: number` | Pan/tilt/zoom a camera |
| `physical.alarm.arm` | C | true | `zone_id: string`, `mode: string` | Arm a physical security alarm zone |
| `physical.alarm.disarm` | C | true | `zone_id: string`, `reason: string` | Disarm a physical security alarm zone |
| `physical.alarm.acknowledge` | B | false | `event_id: string`, `responder_id: string` | Acknowledge an alarm event |
| `physical.lock.engage` | C | true | `door_id: string` | Lock a door via electronic latch |
| `physical.lock.disengage` | C | true | `door_id: string` | Unlock a door via electronic latch |
| `physical.lock.status` | A | false | `door_id: string` | Read lock and door state |
| `physical.elevator.restrict` | B | true | `elevator_id: string`, `allowed_floors: number[]` | Restrict elevator floor access |
| `physical.elevator.unrestrict` | B | true | `elevator_id: string` | Remove floor restrictions from an elevator |
| `physical.valve.open` | C | true | `asset_id: string` | Open a physical valve (water, gas, HVAC) |
| `physical.valve.close` | C | true | `asset_id: string` | Close a physical valve |

---

## financial.* (Financial operations)

All `financial.*` capabilities with safety_class `C` MUST trigger a HITL
workflow at L3+ gateways for any invocation. Rate limits (`max_invocations_per_minute`,
aggregate limits via PC-24) MUST be set on grants for these capabilities.

| Capability | safety_class | physical_safety | Args (key: type) | Description |
|---|---|---|---|---|
| `financial.ledger.read` | A | false | `account_id: string`, `from_ms: number`, `to_ms: number` | Read ledger entries for an account |
| `financial.balance.read` | A | false | `account_id: string` | Read current account balance |
| `financial.invoice.create` | B | false | `customer_id: string`, `line_items: object[]`, `due_date: string` | Create an invoice |
| `financial.invoice.send` | B | false | `invoice_id: string` | Send an invoice to the customer |
| `financial.invoice.void` | B | false | `invoice_id: string`, `reason: string` | Void an invoice |
| `financial.payment.initiate` | C | false | `account_id: string`, `amount_usd: number`, `recipient_id: string`, `reference: string` | Initiate a payment |
| `financial.wire.initiate` | C | false | `account_id: string`, `amount_usd: number`, `routing_number: string`, `account_number: string`, `reference: string` | Initiate a wire transfer |
| `financial.refund.issue` | C | false | `payment_id: string`, `amount_usd: number`, `reason: string` | Issue a refund against a prior payment |
| `financial.approval.request` | B | false | `subject_id: string`, `approval_type: string`, `amount_usd: number`, `approver_ids: string[]` | Request approval for a financial action |
| `financial.approval.grant` | C | false | `approval_request_id: string`, `approver_id: string`, `note: string` | Grant approval for a financial action |
| `financial.po.create` | B | false | `vendor_id: string`, `line_items: object[]`, `total_usd: number` | Create a purchase order |
| `financial.po.approve` | C | false | `po_id: string`, `approver_id: string` | Approve a purchase order |

---

## mcp.* (MCP tool server capabilities)

MCP tool server capabilities use the `mcp.` prefix followed by the server name
and tool name. The pattern `mcp.tool.*` refers to any generic tool call. Named
patterns (`mcp.github.*`, `mcp.email.*`) refer to well-known MCP servers.

| Capability | safety_class | physical_safety | Args (key: type) | Description |
|---|---|---|---|---|
| `mcp.tool.code_execution` | B | false | `code: string`, `language: string`, `timeout_s: number` | Execute code in a sandboxed environment |
| `mcp.tool.file_write` | B | false | `path: string`, `content: string` | Write a file on the host system |
| `mcp.tool.file_read` | A | false | `path: string` | Read a file from the host system |
| `mcp.tool.web_search` | A | false | `query: string`, `max_results: number` | Perform a web search |
| `mcp.tool.web_fetch` | A | false | `url: string` | Fetch the content of a URL |
| `mcp.github.read_repo` | A | false | `owner: string`, `repo: string` | Read repository metadata and files |
| `mcp.github.create_pr` | B | false | `owner: string`, `repo: string`, `title: string`, `head: string`, `base: string` | Open a pull request |
| `mcp.github.merge_pr` | C | false | `owner: string`, `repo: string`, `pull_number: number`, `merge_method: string` | Merge a pull request |
| `mcp.github.push_branch` | B | false | `owner: string`, `repo: string`, `branch: string` | Push commits to a branch |
| `mcp.github.delete_branch` | B | false | `owner: string`, `repo: string`, `branch: string` | Delete a branch |
| `mcp.email.send` | B | false | `to: string`, `subject: string`, `body: string` | Send an email |
| `mcp.email.read` | A | false | `mailbox: string`, `from_ms: number` | Read emails from a mailbox |
| `mcp.slack.post` | B | false | `channel: string`, `text: string` | Post a message to a Slack channel |
| `mcp.slack.read` | A | false | `channel: string`, `from_ms: number` | Read messages from a Slack channel |
| `mcp.database.query` | A | false | `connection_id: string`, `sql: string` | Execute a read-only SQL query |
| `mcp.database.write` | C | false | `connection_id: string`, `sql: string` | Execute a write SQL statement |

---

## game.* (Gaming and interactive media)

| Capability | safety_class | physical_safety | Args (key: type) | Description |
|---|---|---|---|---|
| `game.scene.set-lighting` | B | false | `scene_id: string`, `brightness_pct: number (0-100)`, `color_hex: string` | Synchronize in-game scene lighting to physical environment |
| `game.haptic.pulse` | A | false | `pattern: string ("short-sharp"\|"long-rumble"\|"double-tap"\|"slow-pulse")`, `duration_ms: number`, `intensity: number (0.0-1.0)` | Trigger a haptic pattern on a controller or wearable |
| `game.haptic.continuous` | A | false | `intensity: number (0.0-1.0)`, `duration_ms: number` | Run a continuous haptic effect |
| `game.push.notify` | A | false | `topics: string`, `title: string`, `body: string`, `data: object` | Send a push notification for a game event |
| `game.display.brightness` | B | false | `display_id: string`, `brightness_pct: number (0-100)` | Set a display's brightness |
| `game.audio.ambient` | A | false | `zone_id: string`, `track: string`, `volume: number (0-100)`, `loop: boolean` | Play ambient audio synchronized to a game state |
| `game.audio.stop` | A | false | `zone_id: string` | Stop ambient audio |
| `game.achievement.unlock` | A | false | `player_id: string`, `achievement_id: string` | Unlock a player achievement |
| `game.session.start` | B | false | `player_id: string`, `game_id: string` | Signal the start of a game session (may activate environmental grants) |
| `game.session.end` | B | false | `player_id: string`, `game_id: string` | Signal the end of a game session (triggers grant cleanup) |

---

## gap.* (GAP protocol management)

`gap.*` capabilities govern the GAP protocol itself. They are used by
administrative actors that manage the fabric: issuing grants, querying the
discovery surface, and performing revocations.

| Capability | safety_class | physical_safety | Args (key: type) | Description |
|---|---|---|---|---|
| `gap.discovery.query` | A | false | `capability_pattern: string`, `actor_type: string` | Query the capability discovery surface for a tenant |
| `gap.grant.read` | A | false | `grant_oid: string` | Read a grant CDRO by OID |
| `gap.grant.issue` | C | false | `grantee_oid: string`, `capability_scopes: object[]`, `expires_at_ms: number` | Issue a new capability grant (operator-only) |
| `gap.grant.revoke` | C | false | `grant_oid: string`, `reason: string` | Revoke a capability grant (operator-only) |
| `gap.revoke.provisional-block` | C | false | `target_oid: string`, `reason: string` | Initiate an emergency provisional block |
| `gap.receipt.read` | A | false | `receipt_oid: string` | Fetch a decision receipt by OID |
| `gap.receipt.list` | A | false | `actor_oid: string`, `from_ms: number`, `to_ms: number` | List receipts for an actor in a time range |
| `gap.workflow.register` | B | false | `workflow_definition: object` | Register a new workflow definition |
| `gap.workflow.signal` | B | false | `workflow_instance_oid: string`, `channel: string`, `event: object` | Inject a channel signal into a workflow instance |

---

## messaging.* (Messaging and notification)

| Capability | safety_class | physical_safety | Args (key: type) | Description |
|---|---|---|---|---|
| `messaging.push.send` | A | false | `topics: string`, `title: string`, `body: string`, `data: object` | Send a push notification to a registered device |
| `messaging.push.broadcast` | B | false | `audience: string`, `title: string`, `body: string` | Broadcast a push notification to an audience segment |
| `messaging.email.send` | B | false | `to: string`, `subject: string`, `body: string`, `cc: string` | Send an email |
| `messaging.email.send-template` | B | false | `to: string`, `template_id: string`, `vars: object` | Send a templated email |
| `messaging.sms.send` | B | false | `to: string`, `body: string` | Send an SMS message |
| `messaging.sms.send-bulk` | B | false | `recipients: string[]`, `body: string` | Send an SMS to multiple recipients |
| `messaging.webhook.post` | B | false | `url: string`, `payload: object`, `headers: object` | POST a payload to a webhook URL |
| `messaging.slack.post` | B | false | `channel: string`, `text: string`, `blocks: object` | Send a Slack message |

---

## Registering custom capabilities

Implementors who need capabilities not listed above SHOULD use a reverse-domain
prefix to avoid collisions with future additions to this taxonomy:

```
com.acme.manufacturing.kiln.set-temp
io.example.fleet.vehicle.geofence
```

Custom capabilities MUST follow the same dotted-taxonomy convention and MUST
carry `safety_class` and `physical_safety` fields on their declaration.

Implementors are encouraged to contribute well-defined custom capabilities back
to this taxonomy via a pull request (see CONTRIBUTING.md). New top-level
domains that represent a coherent environment category will be considered for
addition to this file.
