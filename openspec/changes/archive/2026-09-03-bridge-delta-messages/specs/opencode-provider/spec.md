# Delta for opencode-provider

## ADDED Requirements

### Requirement: Streaming Reasoning Content

The system MUST forward `step_update text_delta` events from the upstream API as Server-Sent Events (SSE) progress chunks containing `choices[0].delta.reasoning_content` in both the autonomous and tool-loop streaming paths. Empty deltas MUST be skipped. The tool-loop path MUST add a 10s `: keepalive` comment interval. The final chunk MUST retain the final answer in `content` or `tool_calls` so clients ignoring `reasoning_content` gracefully degrade.

#### Scenario: Autonomous streaming path
- GIVEN an `auto-*` streaming request without tool calls
- WHEN the upstream model emits `step_update text_delta` events
- THEN the bridge MUST forward them as `reasoning_content` deltas
- AND the final chunk MUST contain the full response in `content`

#### Scenario: Tool-loop streaming path
- GIVEN an `auto-*` streaming request involving a tool loop
- WHEN the upstream model emits `text_delta` events
- THEN the bridge MUST forward them as `reasoning_content` deltas
- AND it MUST emit `: keepalive` comments every 10 seconds if no other chunks are sent
- AND the final chunk MUST contain the correctly parsed `tool_calls` and `content`

#### Scenario: Graceful degradation (empty skip & final content)
- GIVEN empty `text_delta` events are emitted by the model
- WHEN processing deltas
- THEN empty string deltas MUST be skipped
- AND the final client that ignores `reasoning_content` MUST still receive the unchanged final `content`
