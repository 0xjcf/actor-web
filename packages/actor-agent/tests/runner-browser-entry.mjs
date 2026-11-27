import { LLM_TOOL_NAME } from '@actor-web/agent';
import { smoke } from './runner-smoke.mjs';

// Start from module evaluation, before a bundler's trailing initializers can run.
export const toolName = LLM_TOOL_NAME;
export const execution = await smoke(undefined, undefined, {}, true);
