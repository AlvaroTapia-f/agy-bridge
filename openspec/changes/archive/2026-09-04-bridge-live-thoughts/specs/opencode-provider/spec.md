# Delta for opencode-provider

## MODIFIED Requirements

### Requirement: Streaming Reasoning Content

The system MUST forward `step_update` events from the upstream API as Server-Sent Events (SSE) progress chunks in both the autonomous and tool-loop streaming paths. `agent_response.text_delta` MUST be routed to `choices[0].delta.content` live. All other step types (intermediate thoughts, tool activity, and unknown steps) MUST be routed to `choices[0].delta.reasoning_content` live. Unknown step types SHOULD be logged. Empty deltas MUST be skipped. Both paths MUST maintain a 10s `: keepalive` comment interval. The final chunk MUST carry `stop` (or parsed `tool_calls`) and MUST NOT duplicate or re-emit the full response text.
(Previously: forwarded all text deltas to reasoning_content, final chunk dumped full content)

#### Scenario: Autonomous streaming path

- GIVEN an `auto-*` streaming request without tool calls
- WHEN the upstream model emits thought or tool `step_update` events
- THEN the bridge MUST forward them as `reasoning_content` deltas
- AND WHEN the model emits `agent_response.text_delta` events
- THEN the bridge MUST forward them as `content` deltas
- AND the final chunk MUST carry `stop` without duplicating the final text

#### Scenario: Tool-loop streaming path

- GIVEN an `auto-*` streaming request involving a tool loop
- WHEN tool-call tags are split across live deltas
- THEN they MUST be streamed as display-only `content` deltas
- AND the final chunk MUST contain the correctly parsed `tool_calls` without a duplicate full text dump

#### Scenario: Graceful degradation (empty skip & keepalive)

- GIVEN a streaming request with periods of inactivity or empty deltas
- WHEN empty `text_delta` events are emitted
- THEN the bridge MUST skip empty string deltas
- AND IF no other chunks are sent for 10 seconds
- THEN the bridge MUST emit `: keepalive` comments

#### Scenario: Defensive routing for unknown steps

- GIVEN a streaming request
- WHEN the upstream model emits an unknown `step_update` type
- THEN the bridge MUST log the event
- AND route it to `reasoning_content` deltas
