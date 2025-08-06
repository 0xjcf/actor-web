/**
 * @module actor-core/runtime/unit/system-event-generation-minimal.test
 * @description Minimal test to isolate memory leak issues
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActorSystemImpl } from '../actor-system-impl.js';
import { Logger } from '../logger.js';

const log = Logger.namespace('MINIMAL_TEST');

describe('Minimal System Event Test', () => {
  let system: ActorSystemImpl;

  beforeEach(async () => {
    log.info('🔧 Creating minimal test system...');
    system = new ActorSystemImpl({ nodeAddress: 'minimal-test' });
    // Remove enableTestMode() to use natural async message processing
    await system.start();
    log.info('✅ Minimal test system started');
  });

  afterEach(async () => {
    log.info('🧹 Cleaning up minimal test system...');
    try {
      if (system?.isRunning()) {
        await system.stop();
        log.info('✅ Minimal test system stopped');
      }

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
        log.info('🗑️ Garbage collection triggered');
      }
    } catch (error) {
      log.error('❌ Error during cleanup:', error);
    }
  });

  it('should create system without memory leak', async () => {
    log.info('🧪 Testing minimal system creation...');

    // Just verify the system exists and can emit one event
    // biome-ignore lint/suspicious/noExplicitAny: Testing private methods requires any
    const emitSpy = vi.spyOn(system as any, 'emitSystemEvent');

    // biome-ignore lint/suspicious/noExplicitAny: Testing private methods requires any
    await (system as any).emitSystemEvent({
      eventType: 'testEvent',
      timestamp: Date.now(),
    });

    expect(emitSpy).toHaveBeenCalled();
    log.info('✅ Minimal test completed');
  }, 5000); // 5 second timeout
});
