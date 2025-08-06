/**
 * @module actor-core/performance/baseline-test
 * @description Baseline performance measurement test for Core Runtime optimization
 */

import { createActorSystem } from '../actor-system-impl.js';
import { Logger } from '../logger.js';
import { PerformanceBenchmark } from './benchmark.js';
import type { BaselineMetrics } from './index.js';

const log = Logger.namespace('TEST');
/**
 * Run baseline performance measurements on the current actor system
 * This establishes the current performance characteristics before optimization
 */
export async function runBaselineTest(): Promise<BaselineMetrics> {
  log.debug('🚀 Starting Core Runtime Performance Baseline Test');
  log.debug('================================================');

  // Create actor system for testing
  const system = createActorSystem({
    nodeAddress: 'baseline-test-node',
    debug: false, // Disable debug logging for cleaner measurements
  });

  try {
    // Start the system
    await system.start();
    log.debug('✅ Actor system started');

    // Create benchmark instance
    const benchmark = new PerformanceBenchmark(system);

    // Run baseline measurements
    log.debug('\n📊 Measuring baseline performance...');
    const baseline = await benchmark.measureBaseline();

    log.debug('\n🎯 Performance Target Analysis:');
    log.debug('===============================');

    // Analyze against targets
    const targets = {
      actorCreation: 1.0, // <1ms target
      messageRate: 10000, // >10,000 msg/sec target
      memoryUsage: 10.0, // <10MB target
    };

    log.debug(
      `Actor Creation: ${baseline.actorCreationTime.toFixed(2)}ms ${
        baseline.actorCreationTime < targets.actorCreation ? '✅' : '❌'
      } (target: <${targets.actorCreation}ms)`
    );

    log.debug(
      `Message Rate: ${baseline.messageProcessingRate.toFixed(0)} msg/sec ${
        baseline.messageProcessingRate > targets.messageRate ? '✅' : '❌'
      } (target: >${targets.messageRate})`
    );

    log.debug(
      `Memory Usage: ${baseline.memoryUsage.toFixed(2)}MB ${
        baseline.memoryUsage < targets.memoryUsage ? '✅' : '❌'
      } (target: <${targets.memoryUsage}MB)`
    );

    log.debug(`Ask Pattern Latency: ${baseline.askPatternLatency.toFixed(2)}ms`);
    log.debug(`Actor Destruction: ${baseline.actorDestructionTime.toFixed(2)}ms`);
    log.debug(`CPU Utilization: ${baseline.cpuUtilization.toFixed(1)}%`);

    // Calculate optimization potential
    log.debug('\n🔧 Optimization Opportunities:');
    log.debug('==============================');

    if (baseline.actorCreationTime > targets.actorCreation) {
      const improvement =
        ((baseline.actorCreationTime - targets.actorCreation) / baseline.actorCreationTime) * 100;
      log.debug(`• Actor Creation: ${improvement.toFixed(1)}% improvement needed`);
    }

    if (baseline.messageProcessingRate < targets.messageRate) {
      const improvement =
        ((targets.messageRate - baseline.messageProcessingRate) / baseline.messageProcessingRate) *
        100;
      log.debug(`• Message Rate: ${improvement.toFixed(1)}% improvement needed`);
    }

    if (baseline.memoryUsage > targets.memoryUsage) {
      const improvement =
        ((baseline.memoryUsage - targets.memoryUsage) / baseline.memoryUsage) * 100;
      log.debug(`• Memory Usage: ${improvement.toFixed(1)}% reduction needed`);
    }

    return baseline;
  } finally {
    // Clean shutdown
    await system.stop();
    log.debug('\n✅ Actor system stopped');
    log.debug('🏁 Baseline test completed\n');
  }
}

/**
 * Run baseline test if this file is executed directly
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  runBaselineTest()
    .then((baseline) => {
      log.debug('📋 Baseline Results Summary:');
      log.debug(JSON.stringify(baseline, null, 2));
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Baseline test failed:', error);
      process.exit(1);
    });
}
