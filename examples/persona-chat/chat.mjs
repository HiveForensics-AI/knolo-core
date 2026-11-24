#!/usr/bin/env node
/**
 * Host adapter for a persona pack.
 * Knolo core does not call a model. The host owns the endpoint.
 */
import { answerPersona } from '../../packages/cli/bin/persona.mjs';

try {
  const result = await answerPersona(process.argv.slice(2));
  if (result?.exitCode) process.exit(result.exitCode);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
