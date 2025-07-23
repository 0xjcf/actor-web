#!/usr/bin/env node

// Simple runner for the capability security example
import {
  DocumentManagementExample,
  WorkflowAutomationExample,
} from './src/examples/capability-security-example.js';

async function runExamples() {
  console.log('🔐 Running Capability Security Examples...\n');

  try {
    console.log('📄 Document Management Example:');
    await DocumentManagementExample.demonstrateCapabilityBasedSecurity();

    console.log('\n🔄 Workflow Automation Example:');
    await WorkflowAutomationExample.demonstrateWorkflowAutomation();

    console.log('\n✅ All examples completed successfully!');
  } catch (error) {
    console.error('❌ Example failed:', error);
    process.exit(1);
  }
}

runExamples();
