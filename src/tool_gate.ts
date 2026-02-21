import { assertToolAllowed, type AgentDefinitionV1 } from './agent.js';
import { isToolCallV1, type ToolCallV1 } from './tools.js';

export function assertToolCallAllowed(
  agent: AgentDefinitionV1,
  call: ToolCallV1
): void {
  if (!isToolCallV1(call)) {
    throw new Error('tool call must be a valid ToolCallV1 object.');
  }
  assertToolAllowed(agent, call.tool);
}
