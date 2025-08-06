/**
 * @module actor-core/performance/memory-monitor
 * @description Memory usage monitoring and leak detection for actor system optimization
 */

export interface MemoryUsage {
  /** Total memory usage in MB */
  total: number;
  /** Used memory in MB */
  used: number;
  /** External memory in MB */
  external: number;
  /** Array buffer memory in MB */
  arrayBuffers: number;
  /** Heap size limit in MB */
  heapSizeLimit: number;
}

export interface MemoryLeak {
  /** Type of object that may be leaking */
  type: string;
  /** Estimated leaked objects count */
  count: number;
  /** Estimated memory impact in MB */
  memoryImpact: number;
  /** Confidence level (0-1) */
  confidence: number;
}

/**
 * Monitors memory usage and detects potential memory leaks
 */
export class MemoryMonitor {
  private baselineMemory?: MemoryUsage;
  private measurements: MemoryUsage[] = [];
  private maxMeasurements = 1000;

  /**
   * Get current memory usage in MB
   */
  getCurrentMemoryUsage(): number {
    if (typeof process !== 'undefined' && process.memoryUsage) {
      const usage = process.memoryUsage();
      return usage.heapUsed / (1024 * 1024); // Convert to MB
    }

    // Browser fallback (limited info)
    if (typeof performance !== 'undefined' && 'memory' in performance) {
      const memory = (performance as unknown as { memory: { usedJSHeapSize: number } }).memory;
      return memory.usedJSHeapSize / (1024 * 1024);
    }

    return 0; // Unable to measure
  }

  /**
   * Get detailed memory usage information
   */
  getDetailedMemoryUsage(): MemoryUsage {
    if (typeof process !== 'undefined' && process.memoryUsage) {
      const usage = process.memoryUsage();
      return {
        total: usage.rss / (1024 * 1024),
        used: usage.heapUsed / (1024 * 1024),
        external: usage.external / (1024 * 1024),
        arrayBuffers: usage.arrayBuffers / (1024 * 1024),
        heapSizeLimit: 0, // Not available in Node.js memoryUsage
      };
    }

    // Browser fallback
    if (typeof performance !== 'undefined' && 'memory' in performance) {
      const memory = (
        performance as unknown as {
          memory: {
            usedJSHeapSize: number;
            totalJSHeapSize: number;
            jsHeapSizeLimit: number;
          };
        }
      ).memory;

      return {
        total: memory.totalJSHeapSize / (1024 * 1024),
        used: memory.usedJSHeapSize / (1024 * 1024),
        external: 0,
        arrayBuffers: 0,
        heapSizeLimit: memory.jsHeapSizeLimit / (1024 * 1024),
      };
    }

    return {
      total: 0,
      used: 0,
      external: 0,
      arrayBuffers: 0,
      heapSizeLimit: 0,
    };
  }

  /**
   * Record current memory usage for tracking
   */
  recordMeasurement(): void {
    const usage = this.getDetailedMemoryUsage();
    this.measurements.push(usage);

    // Keep only recent measurements
    if (this.measurements.length > this.maxMeasurements) {
      this.measurements.shift();
    }

    // Set baseline if not set
    if (!this.baselineMemory) {
      this.baselineMemory = usage;
    }
  }

  /**
   * Detect potential memory leaks
   */
  async detectLeaks(): Promise<MemoryLeak[]> {
    if (this.measurements.length < 10) {
      return []; // Need more measurements
    }

    const leaks: MemoryLeak[] = [];
    const recent = this.measurements.slice(-10);
    const older = this.measurements.slice(-20, -10);

    if (older.length === 0) {
      return [];
    }

    // Calculate average memory usage for recent vs older measurements
    const recentAvg = recent.reduce((sum, m) => sum + m.used, 0) / recent.length;
    const olderAvg = older.reduce((sum, m) => sum + m.used, 0) / older.length;

    // Check for memory growth trend
    const growthRate = (recentAvg - olderAvg) / olderAvg;

    if (growthRate > 0.1) {
      // 10% growth might indicate a leak
      leaks.push({
        type: 'General Memory Growth',
        count: 0, // Unknown
        memoryImpact: recentAvg - olderAvg,
        confidence: Math.min(growthRate * 2, 1),
      });
    }

    // Force garbage collection if available and check again
    if (typeof global !== 'undefined' && global.gc) {
      global.gc();

      // Wait a bit then measure again
      await new Promise((resolve) => setTimeout(resolve, 100));

      const postGCUsage = this.getCurrentMemoryUsage();
      if (postGCUsage > recentAvg * 0.9) {
        // Still high after GC
        leaks.push({
          type: 'Post-GC High Memory',
          count: 0,
          memoryImpact: postGCUsage - olderAvg * 0.8, // Expected after GC
          confidence: 0.8,
        });
      }
    }

    return leaks;
  }

  /**
   * Get memory usage statistics
   */
  getMemoryStats(): {
    current: MemoryUsage;
    baseline: MemoryUsage | undefined;
    growth: number; // MB
    measurements: number;
  } {
    const current = this.getDetailedMemoryUsage();
    const growth = this.baselineMemory ? current.used - this.baselineMemory.used : 0;

    return {
      current,
      baseline: this.baselineMemory,
      growth,
      measurements: this.measurements.length,
    };
  }

  /**
   * Reset memory monitoring
   */
  reset(): void {
    this.baselineMemory = undefined;
    this.measurements = [];
  }
}
