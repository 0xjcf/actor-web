/**
 * @module actor-core/performance/metrics-collector
 * @description Real-time performance metrics collection and aggregation
 */

export interface PerformanceMetric {
  /** Metric name */
  name: string;
  /** Metric value */
  value: number;
  /** Timestamp when metric was recorded */
  timestamp: number;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

export interface MetricsSummary {
  /** Average value */
  average: number;
  /** Minimum value */
  min: number;
  /** Maximum value */
  max: number;
  /** Total count of measurements */
  count: number;
  /** Standard deviation */
  stdDev: number;
  /** 95th percentile */
  p95: number;
  /** 99th percentile */
  p99: number;
}

/**
 * Collects and aggregates performance metrics for the actor system
 */
export class MetricsCollector {
  private metrics = new Map<string, PerformanceMetric[]>();
  private maxMetricsPerType = 10000;

  /**
   * Record a performance metric
   */
  record(name: string, value: number, metadata?: Record<string, unknown>): void {
    const metric: PerformanceMetric = {
      name,
      value,
      timestamp: Date.now(),
      metadata,
    };

    if (!this.metrics.has(name)) {
      this.metrics.set(name, []);
    }

    const metricList = this.metrics.get(name);
    if (metricList) {
      metricList.push(metric);

      // Keep only recent metrics
      if (metricList.length > this.maxMetricsPerType) {
        metricList.shift();
      }
    }
  }

  /**
   * Get summary statistics for a metric
   */
  getSummary(name: string): MetricsSummary | undefined {
    const metricList = this.metrics.get(name);
    if (!metricList || metricList.length === 0) {
      return undefined;
    }

    const values = metricList.map((m) => m.value).sort((a, b) => a - b);
    const count = values.length;

    if (count === 0) {
      return undefined;
    }

    const sum = values.reduce((total, value) => total + value, 0);
    const average = sum / count;
    const min = values[0];
    const max = values[count - 1];

    // Calculate standard deviation
    const variance = values.reduce((total, value) => total + (value - average) ** 2, 0) / count;
    const stdDev = Math.sqrt(variance);

    // Calculate percentiles
    const p95Index = Math.floor(count * 0.95);
    const p99Index = Math.floor(count * 0.99);
    const p95 = values[p95Index] || max;
    const p99 = values[p99Index] || max;

    return {
      average,
      min,
      max,
      count,
      stdDev,
      p95,
      p99,
    };
  }

  /**
   * Get all available metric names
   */
  getMetricNames(): string[] {
    return Array.from(this.metrics.keys());
  }

  /**
   * Get recent metrics for a given name
   */
  getRecentMetrics(name: string, limit = 100): PerformanceMetric[] {
    const metricList = this.metrics.get(name);
    if (!metricList) {
      return [];
    }

    return metricList.slice(-limit);
  }

  /**
   * Clear all metrics
   */
  clear(): void {
    this.metrics.clear();
  }

  /**
   * Clear metrics for a specific name
   */
  clearMetric(name: string): void {
    this.metrics.delete(name);
  }

  /**
   * Get current metrics count
   */
  getMetricsCount(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const [name, metricList] of this.metrics) {
      counts[name] = metricList.length;
    }
    return counts;
  }

  /**
   * Export all metrics as JSON
   */
  exportMetrics(): Record<string, PerformanceMetric[]> {
    const exported: Record<string, PerformanceMetric[]> = {};
    for (const [name, metricList] of this.metrics) {
      exported[name] = [...metricList];
    }
    return exported;
  }

  /**
   * Import metrics from JSON
   */
  importMetrics(data: Record<string, PerformanceMetric[]>): void {
    this.clear();
    for (const [name, metricList] of Object.entries(data)) {
      this.metrics.set(name, [...metricList]);
    }
  }
}
