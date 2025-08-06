/**
 * @module actor-core/performance
 * @description Performance benchmarking infrastructure for Core Runtime Layer optimization
 *
 * This module provides comprehensive performance measurement and monitoring capabilities:
 * 1. Actor lifecycle benchmarking (creation/destruction times)
 * 2. Message throughput measurement and analysis
 * 3. Memory usage tracking and leak detection
 * 4. Performance regression detection
 * 5. Load testing utilities
 *
 * Used for establishing baseline metrics and validating optimization targets:
 * - Actor creation: <1ms target
 * - Message throughput: >10,000 messages/sec target
 * - Memory usage: <10MB base target
 * - Zero memory leaks after 1M messages
 *
 * @author 0xjcf - Core Runtime Optimization
 * @version 1.0.0
 */

// Performance measurement types
export interface BaselineMetrics {
  /** Average actor creation time in milliseconds */
  actorCreationTime: number;
  /** Actor destruction time in milliseconds */
  actorDestructionTime: number;
  /** Messages processed per second */
  messageProcessingRate: number;
  /** Base memory usage in MB */
  memoryUsage: number;
  /** CPU utilization percentage under load */
  cpuUtilization: number;
  /** Ask pattern response time in milliseconds */
  askPatternLatency: number;
}

export interface OptimizationImpact {
  /** Name of the optimization being measured */
  name: string;
  /** Metrics before optimization */
  before: BaselineMetrics;
  /** Metrics after optimization */
  after: BaselineMetrics;
  /** Performance improvement percentages */
  improvement: {
    actorCreation: number;
    messageRate: number;
    memoryUsage: number;
    askLatency: number;
  };
}

export interface RegressionReport {
  /** Whether a regression was detected */
  hasRegression: boolean;
  /** Metrics that regressed */
  regressions: Array<{
    metric: keyof BaselineMetrics;
    current: number;
    baseline: number;
    degradation: number; // percentage
  }>;
  /** Timestamp of measurement */
  timestamp: number;
}

export interface LoadTestConfig {
  /** Number of actors to create */
  actorCount: number;
  /** Messages per second to send */
  messageRate: number;
  /** Duration of test in seconds */
  duration: number;
  /** Whether to measure memory during test */
  measureMemory: boolean;
  /** Whether to simulate actor churn (create/destroy) */
  simulateChurn: boolean;
}

export interface LoadTestResults {
  /** Configuration used for the test */
  config: LoadTestConfig;
  /** Achieved message throughput */
  actualThroughput: number;
  /** Average message latency */
  averageLatency: number;
  /** Peak memory usage during test */
  peakMemoryUsage: number;
  /** Memory at end of test */
  finalMemoryUsage: number;
  /** Errors encountered during test */
  errorCount: number;
  /** Test duration in milliseconds */
  actualDuration: number;
}

// Export main benchmarking class
export { PerformanceBenchmark } from './benchmark.js';
export { LoadTester } from './load-tester.js';
export { MemoryMonitor } from './memory-monitor.js';
export { MetricsCollector } from './metrics-collector.js';
