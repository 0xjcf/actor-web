/**
 * @module actor-core/performance/benchmark
 * @description Main performance benchmarking coordinator for Actor System optimization
 */

import type { ActorMessage, ActorSystem } from '../actor-system.js';
import { defineActor } from '../index.js';
import { Logger } from '../logger.js';
import type { BaselineMetrics, OptimizationImpact, RegressionReport } from './index.js';
import { MemoryMonitor } from './memory-monitor.js';

const log = Logger.namespace('TEST');
/**
 * Main performance benchmarking class that measures actor system baseline performance
 * and tracks optimization improvements
 */
export class PerformanceBenchmark {
  private memoryMonitor: MemoryMonitor;
  private baselineMetrics?: BaselineMetrics;

  constructor(private readonly system: ActorSystem) {
    this.memoryMonitor = new MemoryMonitor();
  }

  /**
   * Measure current system baseline performance across all key metrics
   */
  async measureBaseline(): Promise<BaselineMetrics> {
    log.debug('🔍 Measuring Actor System baseline performance...');

    // Measure actor creation performance
    const actorCreationTime = await this.measureActorCreation();

    // Measure actor destruction performance
    const actorDestructionTime = await this.measureActorDestruction();

    // Measure message processing rate
    const messageProcessingRate = await this.measureMessageThroughput();

    // Measure ask pattern latency
    const askPatternLatency = await this.measureAskPatternLatency();

    // Measure memory usage
    const memoryUsage = this.memoryMonitor.getCurrentMemoryUsage();

    // CPU utilization during load (simplified measurement)
    const cpuUtilization = await this.measureCpuUtilization();

    const baseline: BaselineMetrics = {
      actorCreationTime,
      actorDestructionTime,
      messageProcessingRate,
      memoryUsage,
      cpuUtilization,
      askPatternLatency,
    };

    this.baselineMetrics = baseline;

    log.debug('📊 Baseline Performance Metrics:');
    log.debug(`  Actor Creation: ${actorCreationTime.toFixed(2)}ms (target: <1ms)`);
    log.debug(`  Actor Destruction: ${actorDestructionTime.toFixed(2)}ms`);
    log.debug(`  Message Rate: ${messageProcessingRate.toFixed(0)} msg/sec (target: >10,000)`);
    log.debug(`  Ask Latency: ${askPatternLatency.toFixed(2)}ms`);
    log.debug(`  Memory Usage: ${memoryUsage.toFixed(2)}MB (target: <10MB)`);
    log.debug(`  CPU Utilization: ${cpuUtilization.toFixed(1)}%`);

    return baseline;
  }

  /**
   * Measure the impact of a specific optimization
   */
  async measureOptimization(optimizationName: string): Promise<OptimizationImpact> {
    if (!this.baselineMetrics) {
      throw new Error('Must measure baseline before measuring optimization impact');
    }

    log.debug(`🚀 Measuring optimization impact: ${optimizationName}`);

    const after = await this.measureBaseline();
    const before = this.baselineMetrics;

    const improvement = {
      actorCreation: this.calculateImprovement(
        before.actorCreationTime,
        after.actorCreationTime,
        true
      ),
      messageRate: this.calculateImprovement(
        before.messageProcessingRate,
        after.messageProcessingRate,
        false
      ),
      memoryUsage: this.calculateImprovement(before.memoryUsage, after.memoryUsage, true),
      askLatency: this.calculateImprovement(
        before.askPatternLatency,
        after.askPatternLatency,
        true
      ),
    };

    log.debug(`📈 Optimization Impact - ${optimizationName}:`);
    log.debug(`  Actor Creation: ${improvement.actorCreation.toFixed(1)}% improvement`);
    log.debug(`  Message Rate: ${improvement.messageRate.toFixed(1)}% improvement`);
    log.debug(`  Memory Usage: ${improvement.memoryUsage.toFixed(1)}% improvement`);
    log.debug(`  Ask Latency: ${improvement.askLatency.toFixed(1)}% improvement`);

    return {
      name: optimizationName,
      before,
      after,
      improvement,
    };
  }

  /**
   * Detect performance regressions by comparing current metrics to baseline
   */
  detectRegression(current: BaselineMetrics, baseline: BaselineMetrics): RegressionReport {
    const regressions: RegressionReport['regressions'] = [];
    const threshold = 5; // 5% degradation threshold

    // Check each metric for regression (higher values are worse for most metrics)
    const checks = [
      { metric: 'actorCreationTime' as const, higherIsBad: true },
      { metric: 'actorDestructionTime' as const, higherIsBad: true },
      { metric: 'messageProcessingRate' as const, higherIsBad: false },
      { metric: 'memoryUsage' as const, higherIsBad: true },
      { metric: 'askPatternLatency' as const, higherIsBad: true },
    ];

    for (const check of checks) {
      const degradation = check.higherIsBad
        ? ((current[check.metric] - baseline[check.metric]) / baseline[check.metric]) * 100
        : ((baseline[check.metric] - current[check.metric]) / baseline[check.metric]) * 100;

      if (degradation > threshold) {
        regressions.push({
          metric: check.metric,
          current: current[check.metric],
          baseline: baseline[check.metric],
          degradation,
        });
      }
    }

    return {
      hasRegression: regressions.length > 0,
      regressions,
      timestamp: Date.now(),
    };
  }

  /**
   * Measure average actor creation time
   */
  private async measureActorCreation(): Promise<number> {
    const iterations = 100;
    const times: number[] = [];

    // Simple test behavior using fluent API - types automatically inferred!
    const testBehavior = defineActor<ActorMessage>()
      .withContext({})
      .onMessage(() => {
        // Fire-and-forget pattern for performance testing
        return undefined;
      });

    // Pre-warm to avoid cold start effects
    for (let i = 0; i < 10; i++) {
      const pid = await this.system.spawn(testBehavior);
      await this.system.stop(pid);
    }

    // Measure creation times
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      const pid = await this.system.spawn(testBehavior);
      const end = performance.now();

      times.push(end - start);

      // Clean up immediately
      await this.system.stop(pid);
    }

    return times.reduce((sum, time) => sum + time, 0) / times.length;
  }

  /**
   * Measure average actor destruction time
   */
  private async measureActorDestruction(): Promise<number> {
    const iterations = 100;
    const times: number[] = [];

    const testBehavior = defineActor<ActorMessage>()
      .withContext({})
      .onMessage(() => {
        // Fire-and-forget for creation performance testing
        return undefined;
      });

    // Create actors first
    const pids = [];
    for (let i = 0; i < iterations; i++) {
      const pid = await this.system.spawn(testBehavior);
      pids.push(pid);
    }

    // Measure destruction times
    for (const pid of pids) {
      const start = performance.now();
      await this.system.stop(pid);
      const end = performance.now();

      times.push(end - start);
    }

    return times.reduce((sum, time) => sum + time, 0) / times.length;
  }

  /**
   * Measure message processing throughput
   */
  private async measureMessageThroughput(): Promise<number> {
    const duration = 5000; // 5 seconds

    // Create test actor
    let processedCount = 0;
    const testBehavior = defineActor<ActorMessage>()
      .withContext({})
      .onMessage(({ message }) => {
        if (message.type === 'TEST_MESSAGE') {
          processedCount++;
        }
        return undefined;
      });

    const actor = await this.system.spawn(testBehavior);

    // Send messages as fast as possible for duration
    const startTime = performance.now();
    const endTime = startTime + duration;
    let sentCount = 0;

    while (performance.now() < endTime) {
      await actor.send({ type: 'TEST_MESSAGE', data: { id: sentCount } });
      sentCount++;

      // Small delay to prevent overwhelming
      if (sentCount % 100 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
    }

    // Wait a bit for processing to complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    await this.system.stop(actor);

    const actualDuration = (performance.now() - startTime) / 1000;
    return processedCount / actualDuration;
  }

  /**
   * Measure ask pattern latency
   */
  private async measureAskPatternLatency(): Promise<number> {
    const iterations = 100;
    const times: number[] = [];

    const testBehavior = defineActor<ActorMessage>()
      .withContext({})
      .onMessage(() => {
        // Fire-and-forget for ask latency testing - simplified
        return undefined;
      });

    const actor = await this.system.spawn(testBehavior);

    // Pre-warm
    for (let i = 0; i < 10; i++) {
      await actor.ask({ type: 'PING', data: { id: i } });
    }

    // Measure ask pattern latency
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      await actor.ask({ type: 'PING', data: { id: i } });
      const end = performance.now();

      times.push(end - start);
    }

    await this.system.stop(actor);

    return times.reduce((sum, time) => sum + time, 0) / times.length;
  }

  /**
   * Measure CPU utilization (simplified)
   */
  private async measureCpuUtilization(): Promise<number> {
    // This is a simplified measurement - in production you'd use more sophisticated CPU monitoring
    const start = process.hrtime.bigint();

    // Simulate some load
    const testBehavior = defineActor<ActorMessage>()
      .withContext({})
      .onMessage(() => {
        // Fire-and-forget for memory monitoring
        return undefined;
      });

    const actors = [];
    for (let i = 0; i < 10; i++) {
      const actor = await this.system.spawn(testBehavior);
      actors.push(actor);
    }

    // Send messages to create load
    for (const actor of actors) {
      for (let i = 0; i < 100; i++) {
        await actor.send({ type: 'TEST', data: { id: i } });
      }
    }

    // Clean up
    for (const actor of actors) {
      await this.system.stop(actor);
    }

    const end = process.hrtime.bigint();
    const duration = Number(end - start) / 1000000; // Convert to milliseconds

    // Return simplified CPU utilization estimate (this is not accurate, just for demo)
    return Math.min(duration / 1000, 100);
  }

  /**
   * Calculate improvement percentage between two values
   */
  private calculateImprovement(before: number, after: number, lowerIsBetter: boolean): number {
    if (lowerIsBetter) {
      return ((before - after) / before) * 100;
    }
    return ((after - before) / before) * 100;
  }
}
