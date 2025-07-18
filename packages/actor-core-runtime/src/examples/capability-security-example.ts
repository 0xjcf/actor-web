/**
 * @module actor-core/runtime/examples/capability-security-example
 * @description Example demonstrating capability-based security in practice
 * @author Agent A (Tech Lead) - 2025-07-17
 */

import { assign, setup } from 'xstate';
import {
  type Capability,
  SecurityUtils,
  createCapabilityRegistry,
  createSecureActor,
  createSecurityMiddleware,
} from '../capability-security.js';
import { createActorRef } from '../create-actor-ref.js';
import { Logger } from '../logger.js';
import { createVirtualActorSystem } from '../virtual-actor-system.js';

// ========================================================================================
// EXAMPLE: DOCUMENT MANAGEMENT SYSTEM
// ========================================================================================

/**
 * Example document management system with capability-based security
 */
export namespace DocumentManagementExample {
  /**
   * Document interface
   */
  export interface Document {
    id: string;
    title: string;
    content: string;
    author: string;
    createdAt: number;
    updatedAt: number;
    tags: string[];
    access: 'public' | 'private' | 'restricted';
  }

  /**
   * User interface
   */
  export interface User {
    id: string;
    username: string;
    email: string;
    role: 'guest' | 'user' | 'moderator' | 'admin';
    permissions: string[];
  }

  /**
   * Document actor that handles CRUD operations with security
   */
  export const documentActorMachine = setup({
    types: {
      context: {} as {
        documents: Map<string, Document>;
        currentUser?: User;
      },
      events: {} as
        | { type: 'CAPABILITY_INVOKE'; method: string; args: unknown[]; capabilityId: string }
        | { type: 'SET_USER'; user: User }
        | { type: 'CREATE_DOCUMENT'; document: Omit<Document, 'id' | 'createdAt' | 'updatedAt'> }
        | { type: 'READ_DOCUMENT'; id: string }
        | { type: 'UPDATE_DOCUMENT'; id: string; updates: Partial<Document> }
        | { type: 'DELETE_DOCUMENT'; id: string }
        | { type: 'LIST_DOCUMENTS'; filter?: string },
      emitted: {} as
        | { type: 'DOCUMENT_CREATED'; document: Document }
        | { type: 'DOCUMENT_UPDATED'; document: Document }
        | { type: 'DOCUMENT_DELETED'; id: string }
        | {
            type: 'CAPABILITY_RESPONSE';
            capabilityId: string;
            response: unknown;
            requestId: string;
          },
    },
    actions: {
      setUser: assign({
        currentUser: ({ event }) => (event as any).user,
      }),

      handleCapabilityInvoke: ({ context, event }) => {
        const log = Logger.namespace('DOCUMENT_ACTOR');
        const { method, args, capabilityId } = event as any;

        log.debug('Handling capability invoke', { method, args, capabilityId });

        // Route to appropriate method based on capability
        switch (method) {
          case 'createDocument':
            return context.documents.set(generateDocumentId(), {
              ...(args[0] as any),
              id: generateDocumentId(),
              createdAt: Date.now(),
              updatedAt: Date.now(),
            });
          case 'readDocument':
            return context.documents.get(args[0] as string);
          case 'updateDocument':
            const doc = context.documents.get(args[0] as string);
            if (doc) {
              const updated = { ...doc, ...(args[1] as any), updatedAt: Date.now() };
              context.documents.set(doc.id, updated);
              return updated;
            }
            return null;
          case 'deleteDocument':
            return context.documents.delete(args[0] as string);
          case 'listDocuments':
            return Array.from(context.documents.values());
          default:
            throw new Error(`Unknown method: ${method}`);
        }
      },
    },
  }).createMachine({
    id: 'document-actor',
    initial: 'active',
    context: {
      documents: new Map(),
      currentUser: undefined,
    },
    states: {
      active: {
        on: {
          SET_USER: {
            actions: ['setUser'],
          },
          CAPABILITY_INVOKE: {
            actions: ['handleCapabilityInvoke'],
          },
        },
      },
    },
  });

  /**
   * Document service interface for capabilities
   */
  export interface DocumentService {
    createDocument(document: Omit<Document, 'id' | 'createdAt' | 'updatedAt'>): Promise<Document>;
    readDocument(id: string): Promise<Document | null>;
    updateDocument(id: string, updates: Partial<Document>): Promise<Document | null>;
    deleteDocument(id: string): Promise<boolean>;
    listDocuments(filter?: string): Promise<Document[]>;
  }

  /**
   * Example usage of the document management system
   */
  export async function demonstrateCapabilityBasedSecurity() {
    const log = Logger.namespace('DOCUMENT_EXAMPLE');

    // Create the infrastructure with virtual actor system integration
    const virtualActorSystem = createVirtualActorSystem('document-node');
    const registry = createCapabilityRegistry(virtualActorSystem);
    const securityMiddleware = createSecurityMiddleware(registry, virtualActorSystem);

    // Create the document actor
    const documentActor = createActorRef(documentActorMachine);
    documentActor.start();

    // Demonstrate createSecureActor for direct secure actor wrapping
    const secureDocumentActor = createSecureActor<DocumentService>(
      documentActor,
      ['read.*', 'write.*'],
      'system',
      {
        expiresAt: Date.now() + 3600000, // 1 hour
        constraints: { maxRequests: 100 },
      }
    );

    log.info('=== Direct Secure Actor Example ===');
    log.info('createSecureActor() - Direct secure actor creation with specific permissions');
    log.info('Created secure actor with direct permissions');
    log.info('Can read:', secureDocumentActor.can('read.documents'));
    log.info('Can write:', secureDocumentActor.can('write.documents'));
    log.info('Can admin:', secureDocumentActor.can('admin.delete'));

    // Demonstrate security middleware usage
    const secureWrapper = securityMiddleware.secureActor(documentActor);
    log.info('=== Security Middleware Example ===');
    log.info('createSecurityMiddleware() - Middleware-based security wrapping');
    log.info('Created secure wrapper via middleware');

    // Create different users with different permission levels
    const guestUser: User = {
      id: 'guest-1',
      username: 'guest',
      email: 'guest@example.com',
      role: 'guest',
      permissions: ['read.public'],
    };

    const regularUser: User = {
      id: 'user-1',
      username: 'john',
      email: 'john@example.com',
      role: 'user',
      permissions: ['read.*', 'write.own'],
    };

    const moderatorUser: User = {
      id: 'mod-1',
      username: 'moderator',
      email: 'mod@example.com',
      role: 'moderator',
      permissions: ['read.*', 'write.*', 'delete.public'],
    };

    const adminUser: User = {
      id: 'admin-1',
      username: 'admin',
      email: 'admin@example.com',
      role: 'admin',
      permissions: ['*'],
    };

    // Grant capabilities based on user roles
    const guestCapability = await SecurityUtils.createReadOnlyCapability(
      registry,
      documentActor.id,
      'system'
    );

    const userCapability = await SecurityUtils.createConstrainedCapability(
      registry,
      documentActor.id,
      ['read.*', 'write.own'],
      'system',
      { userId: regularUser.id }
    );

    const moderatorCapability = await SecurityUtils.createConstrainedCapability(
      registry,
      documentActor.id,
      ['read.*', 'write.*', 'delete.public'],
      'system',
      { userId: moderatorUser.id }
    );

    const adminCapability = await SecurityUtils.createAdminCapability(
      registry,
      documentActor.id,
      'system'
    );

    // Demonstrate different permission levels
    log.info('=== Guest User Operations ===');
    await demonstrateUserOperations(guestCapability, guestUser, log);

    log.info('=== Regular User Operations ===');
    await demonstrateUserOperations(userCapability, regularUser, log);

    log.info('=== Moderator Operations ===');
    await demonstrateUserOperations(moderatorCapability, moderatorUser, log);

    log.info('=== Admin Operations ===');
    await demonstrateUserOperations(adminCapability, adminUser, log);

    // Demonstrate capability delegation
    log.info('=== Capability Delegation ===');
    const delegatedCapability = await SecurityUtils.createTimeLimitedCapability(
      registry,
      documentActor.id,
      ['read.public'],
      adminCapability.id,
      60000 // 1 minute
    );

    log.info('Delegated capability created with 1-minute expiration');
    log.info('Delegated capability valid:', delegatedCapability.isValid());

    // Demonstrate security middleware secure invocation
    log.info('=== Security Middleware Secure Invocation ===');
    try {
      const result = await secureWrapper.secureInvoke(
        adminCapability.id,
        'listDocuments',
        [],
        'read.documents'
      );
      log.info('✅ Secure invocation successful:', result);
    } catch (error) {
      log.error('❌ Secure invocation failed:', error);
    }

    // Demonstrate direct secure actor usage
    log.info('=== Direct Secure Actor Usage ===');
    try {
      const listResult = await secureDocumentActor.invoke('listDocuments');
      log.info('✅ Direct secure actor invocation successful:', listResult);
    } catch (error) {
      log.error('❌ Direct secure actor invocation failed:', error);
    }

    // Clean up
    await documentActor.stop();
    await registry.cleanup();

    log.info('Document management system demonstration completed');
  }

  /**
   * Demonstrate operations for a specific user capability
   */
  async function demonstrateUserOperations(
    capability: Capability<DocumentService>,
    user: User,
    log: ReturnType<typeof Logger.namespace>
  ) {
    log.info(`Operating as: ${user.username} (${user.role})`);

    try {
      // Try to create a document
      if (capability.can('createDocument')) {
        const newDoc = await capability.invoke('createDocument', {
          title: `Document by ${user.username}`,
          content: 'This is a test document',
          author: user.id,
          tags: ['test', 'example'],
          access: 'public',
        });
        log.info('✅ Document created:', { id: (newDoc as any)?.id });
      } else {
        log.warn('❌ Cannot create documents');
      }

      // Try to read documents
      if (capability.can('listDocuments')) {
        const docs = await capability.invoke('listDocuments');
        log.info('✅ Documents listed:', { count: (docs as any)?.length || 0 });
      } else {
        log.warn('❌ Cannot list documents');
      }

      // Try to delete a document
      if (capability.can('deleteDocument')) {
        log.info('✅ Has delete permissions');
      } else {
        log.warn('❌ Cannot delete documents');
      }
    } catch (error) {
      log.error('❌ Operation failed:', error);
    }
  }

  /**
   * Generate a unique document ID
   */
  function generateDocumentId(): string {
    return `doc-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }
}

// ========================================================================================
// EXAMPLE: WORKFLOW AUTOMATION WITH CAPABILITIES
// ========================================================================================

/**
 * Example workflow automation system with role-based capabilities
 */
export namespace WorkflowAutomationExample {
  /**
   * Workflow step interface
   */
  export interface WorkflowStep {
    id: string;
    name: string;
    type: 'manual' | 'automatic' | 'approval';
    assignee?: string;
    permissions: string[];
    status: 'pending' | 'in_progress' | 'completed' | 'failed';
    data?: unknown;
  }

  /**
   * Workflow interface
   */
  export interface Workflow {
    id: string;
    name: string;
    steps: WorkflowStep[];
    currentStep: number;
    status: 'draft' | 'active' | 'completed' | 'failed';
    createdBy: string;
    createdAt: number;
  }

  /**
   * Create a workflow automation system with capabilities
   */
  export async function demonstrateWorkflowAutomation() {
    const log = Logger.namespace('WORKFLOW_EXAMPLE');
    const virtualActorSystem = createVirtualActorSystem('workflow-node');
    const registry = createCapabilityRegistry(virtualActorSystem);
    const securityMiddleware = createSecurityMiddleware(registry, virtualActorSystem);

    // Create a mock workflow actor for demonstration
    const workflowActor = {
      id: 'workflow-actor',
      status: 'running' as const,
      send: () => {},
      ask: async () => ({ success: true }),
      emit: () => {},
      subscribe: () => () => {},
      on: () => () => {},
      observe: () => ({ subscribe: () => ({ unsubscribe: () => {} }) }),
      start: () => {},
      stop: async () => {},
      restart: async () => {},
      spawn: () => ({}) as any,
      stopChild: async () => {},
      getChildren: () => new Map(),
      matches: () => false,
      accepts: () => false,
      getSnapshot: () => ({
        value: 'idle',
        context: {},
        status: 'running' as const,
        matches: () => false,
        can: () => false,
        hasTag: () => false,
        toJSON: () => ({ value: 'idle', context: {}, status: 'running' }),
      }),
      parent: undefined,
      supervision: undefined,
    } as any;

    // Demonstrate different ways to create secure actors
    const directSecureActor = createSecureActor(
      workflowActor,
      ['workflow.execute', 'workflow.read.*'],
      'system',
      { expiresAt: Date.now() + 1800000 } // 30 minutes
    );

    log.info('=== Direct Secure Workflow Actor ===');
    log.info('Can execute workflows:', directSecureActor.can('workflow.execute'));
    log.info('Can read workflows:', directSecureActor.can('workflow.read.status'));
    log.info('Can admin workflows:', directSecureActor.can('workflow.admin.delete'));

    // Demonstrate security middleware with workflow
    const secureWorkflowWrapper = securityMiddleware.secureActor(workflowActor);
    log.info('=== Security Middleware Workflow Wrapper ===');
    log.info('Created secure workflow wrapper via middleware');

    // Show both approaches in action
    try {
      await directSecureActor.invoke('execute', { workflow: 'test-workflow' });
      log.info('✅ Direct secure actor invocation succeeded');
    } catch (error) {
      log.error('❌ Direct secure actor invocation failed:', error);
    }

    // Create different role-based capabilities
    const workflowCreatorCap = await SecurityUtils.createConstrainedCapability(
      registry,
      'workflow-actor',
      ['workflow.create', 'workflow.read.own', 'workflow.update.own'],
      'system',
      { role: 'creator' }
    );

    const workflowApproverCap = await SecurityUtils.createConstrainedCapability(
      registry,
      'workflow-actor',
      ['workflow.read.*', 'workflow.approve', 'workflow.reject'],
      'system',
      { role: 'approver' }
    );

    const workflowExecutorCap = await SecurityUtils.createConstrainedCapability(
      registry,
      'workflow-actor',
      ['workflow.read.*', 'workflow.execute', 'workflow.update.assigned'],
      'system',
      { role: 'executor' }
    );

    const workflowAdminCap = await SecurityUtils.createAdminCapability(
      registry,
      'workflow-actor',
      'system'
    );

    // Demonstrate workflow operations
    log.info('=== Workflow Creator Operations ===');
    await demonstrateWorkflowOperations(workflowCreatorCap, 'creator', log);

    log.info('=== Workflow Approver Operations ===');
    await demonstrateWorkflowOperations(workflowApproverCap, 'approver', log);

    log.info('=== Workflow Executor Operations ===');
    await demonstrateWorkflowOperations(workflowExecutorCap, 'executor', log);

    log.info('=== Workflow Admin Operations ===');
    await demonstrateWorkflowOperations(workflowAdminCap, 'admin', log);

    // Demonstrate time-limited capabilities for temporary access
    log.info('=== Time-Limited Access ===');
    const tempCap = await SecurityUtils.createTimeLimitedCapability(
      registry,
      'workflow-actor',
      ['workflow.read.public'],
      workflowAdminCap.id,
      5000 // 5 seconds
    );

    log.info('Temporary capability created (5 seconds)');
    log.info('Temporary capability valid:', tempCap.isValid());

    // Wait for expiration
    await new Promise((resolve) => setTimeout(resolve, 6000));
    log.info('After 6 seconds, temporary capability valid:', tempCap.isValid());

    // Clean up
    await registry.cleanup();
    log.info('Workflow automation demonstration completed');
  }

  /**
   * Demonstrate workflow operations for a specific capability
   */
  async function demonstrateWorkflowOperations(
    capability: Capability<unknown>,
    role: string,
    log: ReturnType<typeof Logger.namespace>
  ) {
    log.info(`Operating as: ${role}`);

    const operations = [
      'workflow.create',
      'workflow.read.own',
      'workflow.read.all',
      'workflow.update.own',
      'workflow.update.all',
      'workflow.approve',
      'workflow.reject',
      'workflow.execute',
      'workflow.delete',
    ];

    for (const operation of operations) {
      if (capability.can(operation)) {
        log.info(`✅ Can perform: ${operation}`);
      } else {
        log.warn(`❌ Cannot perform: ${operation}`);
      }
    }
  }
}

// ========================================================================================
// EXAMPLE RUNNER
// ========================================================================================

/**
 * Run all capability security examples
 */
export async function runCapabilitySecurityExamples() {
  const log = Logger.namespace('CAPABILITY_EXAMPLES');

  try {
    log.info('🔐 Starting Capability-Based Security Examples');

    log.info('📄 Running Document Management Example...');
    await DocumentManagementExample.demonstrateCapabilityBasedSecurity();

    log.info('🔄 Running Workflow Automation Example...');
    await WorkflowAutomationExample.demonstrateWorkflowAutomation();

    log.info('✅ All capability security examples completed successfully');
  } catch (error) {
    log.error('❌ Example failed:', error);
    throw error;
  }
}

// Export for use in tests or demos
export { runCapabilitySecurityExamples as default };
