/**
 * Agent Workflow Configuration Example
 *
 * This file shows how to customize agent workspace paths and other settings
 * for the agent-workflow CLI tool.
 *
 * To use this configuration:
 * 1. Copy this file to your project root
 * 2. Rename it to 'agent-workflow.config.js' (or one of the other supported names)
 * 3. Modify the paths and settings as needed
 *
 * Supported config file names:
 * - agent-workflow.config.js
 * - agent-workflow.config.json
 * - .awconfig.js
 * - .awconfig.json
 */

module.exports = {
  // Agent workspace configurations
  agents: [
    {
      agentId: 'agent-a',
      branch: 'feature/agent-a',
      path: '../my-project-architecture', // Custom path for Agent A
      role: 'Architecture',
    },
    {
      agentId: 'agent-b',
      branch: 'feature/agent-b',
      path: '../my-project-implementation', // Custom path for Agent B
      role: 'Implementation',
    },
    {
      agentId: 'agent-c',
      branch: 'feature/agent-c',
      path: '../my-project-tests', // Custom path for Agent C
      role: 'Testing',
    },
  ],

  // Base directory for resolving relative paths (optional)
  baseDir: process.cwd(),

  // Integration branch name (optional)
  integrationBranch: 'main',
};

// Alternative: JSON configuration format
// Save as 'agent-workflow.config.json':
/*
{
  "agents": [
    {
      "agentId": "agent-a",
      "branch": "feature/agent-a",
      "path": "../my-project-architecture",
      "role": "Architecture"
    },
    {
      "agentId": "agent-b",
      "branch": "feature/agent-b",
      "path": "../my-project-implementation",
      "role": "Implementation"
    },
    {
      "agentId": "agent-c",
      "branch": "feature/agent-c",
      "path": "../my-project-tests",
      "role": "Testing"
    }
  ],
  "baseDir": ".",
  "integrationBranch": "main"
}
*/
