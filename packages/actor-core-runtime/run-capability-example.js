#!/usr/bin/env node

// Simple runner for the capability security example
import {
  DocumentManagementExample,
  WorkflowAutomationExample,
} from './src/examples/capability-security-example.js';

async function runExamples() {
  log.debug('🔐 Running Capability Security Examples...\n');

  try {
    log.debug('📄 Document Management Example:');
    await DocumentManagementExample.demonstrateCapabilityBasedSecurity();

    log.debug('\n🔄 Workflow Automation Example:');
    await WorkflowAutomationExample.demonstrateWorkflowAutomation();

    log.debug('\n✅ All examples completed successfully!');
  } catch (error) {
    console.error('❌ Example failed:', error);
    process.exit(1);
  }
}

runExamples();
