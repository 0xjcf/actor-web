// ============================================================================
// 🏭 Enhanced Machine Registry - Symbol-Based Machine Management
// ============================================================================
//
// This module provides a centralized registry for XState machines using
// the symbol-based approach. It offers efficient registration, discovery,
// and lifecycle management optimized for large-scale deployments.
//
// ✅ Features:
// - Symbol-based machine identification (collision-resistant)
// - Memory-efficient storage using WeakMap (GC-friendly)
// - Fast lookups by ID, type, and behavior
// - Machine lifecycle tracking and cleanup
// - Performance monitoring and optimization
// - Thread-safe operations for concurrent access

import type { AnyStateMachine } from 'xstate';
import { ActorSymbols } from './actor-symbols.js';
import type { ActorBehavior } from './actor-system.js';
import { Logger } from './logger.js';

const log = Logger.namespace('MACHINE_REGISTRY');

/**
 * Machine registration metadata
 * Contains all information about a registered machine
 */
export interface MachineRegistration {
  readonly id: string; // Unique machine identifier
  readonly machine: AnyStateMachine; // The XState machine instance
  readonly behavior: ActorBehavior<unknown, unknown>; // Associated actor behavior
  readonly registeredAt: number; // Registration timestamp
  readonly type: string; // Machine type (machine.id or 'anonymous')
  readonly symbolId: symbol; // Unique symbol identifier
}

/**
 * Registry statistics for monitoring and optimization
 */
export interface RegistryStats {
  readonly totalRegistrations: number; // Total machines registered
  readonly totalLookups: number; // Total lookup operations
  readonly activeRegistrations: number; // Currently active registrations
  readonly registrationsByType: Record<string, number>; // Count by machine type
  readonly averageLookupTime: number; // Average lookup time in ms
  readonly memoryUsage: {
    behaviorMappings: number; // WeakMap entries (estimated)
    idMappings: number; // ID map size
    typeMappings: number; // Type map size
  };
}

/**
 * Machine discovery options for flexible querying
 */
export interface MachineDiscoveryOptions {
  readonly type?: string; // Filter by machine type
  readonly registeredAfter?: number; // Filter by registration time
  readonly registeredBefore?: number; // Filter by registration time
  readonly limit?: number; // Limit results (for performance)
  readonly includeAnonymous?: boolean; // Include anonymous machines
}

/**
 * Enhanced Symbol-Based Machine Registry
 *
 * Provides centralized management of XState machines with symbol-based
 * identification for collision resistance and security.
 *
 * @example Basic Usage
 * ```typescript
 * const registry = SymbolBasedMachineRegistry.getInstance();
 *
 * // Register a machine
 * const registration = registry.register(behavior, machine);
 *
 * // Lookup by behavior
 * const found = registry.getMachineByBehavior(behavior);
 *
 * // Discover machines by type
 * const counterMachines = registry.discoverMachines({ type: 'counter' });
 *
 * // Cleanup when done
 * registry.unregister(registration.id);
 * ```
 */
export class SymbolBasedMachineRegistry {
  private static instance: SymbolBasedMachineRegistry | null = null;

  // Core storage - optimized for different access patterns
  private readonly machinesByBehavior = new WeakMap<
    ActorBehavior<unknown, unknown>,
    MachineRegistration
  >();
  private readonly machinesById = new Map<string, MachineRegistration>();
  private readonly machinesByType = new Map<string, Set<MachineRegistration>>();
  private readonly machinesBySymbol = new Map<symbol, MachineRegistration>();

  // Performance tracking
  private registrationCount = 0;
  private lookupCount = 0;
  private totalLookupTime = 0;

  /**
   * Singleton access for global machine registry
   * Ensures single source of truth across the application
   */
  public static getInstance(): SymbolBasedMachineRegistry {
    if (!SymbolBasedMachineRegistry.instance) {
      SymbolBasedMachineRegistry.instance = new SymbolBasedMachineRegistry();
      log.info('Initialized global machine registry');
    }
    return SymbolBasedMachineRegistry.instance;
  }

  /**
   * Register a machine with symbol-based identification
   *
   * @param behavior - Actor behavior to associate with the machine
   * @param machine - XState machine to register
   * @returns Registration metadata for tracking and cleanup
   */
  public register(
    behavior: ActorBehavior<unknown, unknown>,
    machine: AnyStateMachine
  ): MachineRegistration {
    const startTime = performance.now();

    // Generate unique identifiers
    const symbolId = Symbol(
      `machine.${machine.id || 'anonymous'}.${Date.now()}.${Math.random().toString(36).substr(2, 9)}`
    );
    const id = `machine_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const type = machine.id || 'anonymous';

    // Create registration record
    const registration: MachineRegistration = {
      id,
      machine,
      behavior,
      registeredAt: Date.now(),
      type,
      symbolId,
    };

    // Store in multiple maps for efficient lookups
    this.machinesByBehavior.set(behavior, registration);
    this.machinesById.set(id, registration);
    this.machinesBySymbol.set(symbolId, registration);

    // Update type index
    if (!this.machinesByType.has(type)) {
      this.machinesByType.set(type, new Set());
    }
    const typeSet = this.machinesByType.get(type);
    if (typeSet) {
      typeSet.add(registration);
    }

    // Attach symbol to behavior for runtime access
    Object.defineProperty(behavior, ActorSymbols.MACHINE, {
      value: machine,
      enumerable: false,
      configurable: false,
      writable: false,
    });

    // Attach registry metadata symbol for debugging
    Object.defineProperty(behavior, Symbol.for('machine.registry.id'), {
      value: id,
      enumerable: false,
      configurable: false,
      writable: false,
    });

    this.registrationCount++;
    const elapsedTime = performance.now() - startTime;
    this.totalLookupTime += elapsedTime;

    log.debug(`Registered machine: ${type} (${id}) in ${elapsedTime.toFixed(2)}ms`);

    return registration;
  }

  /**
   * Get machine registration by behavior (most common lookup)
   * Uses WeakMap for O(1) performance
   */
  public getMachineByBehavior(
    behavior: ActorBehavior<unknown, unknown>
  ): MachineRegistration | undefined {
    const startTime = performance.now();
    this.lookupCount++;

    const registration = this.machinesByBehavior.get(behavior);

    const elapsedTime = performance.now() - startTime;
    this.totalLookupTime += elapsedTime;

    return registration;
  }

  /**
   * Get machine registration by unique ID
   * Uses Map for O(1) performance
   */
  public getMachineById(id: string): MachineRegistration | undefined {
    const startTime = performance.now();
    this.lookupCount++;

    const registration = this.machinesById.get(id);

    const elapsedTime = performance.now() - startTime;
    this.totalLookupTime += elapsedTime;

    return registration;
  }

  /**
   * Get machine registration by symbol ID
   * For advanced symbol-based lookups
   */
  public getMachineBySymbol(symbolId: symbol): MachineRegistration | undefined {
    const startTime = performance.now();
    this.lookupCount++;

    const registration = this.machinesBySymbol.get(symbolId);

    const elapsedTime = performance.now() - startTime;
    this.totalLookupTime += elapsedTime;

    return registration;
  }

  /**
   * Discover machines by various criteria
   * Supports flexible querying with performance optimization
   */
  public discoverMachines(options: MachineDiscoveryOptions = {}): MachineRegistration[] {
    const startTime = performance.now();
    this.lookupCount++;

    let candidates: MachineRegistration[] = [];

    // Start with type filter if specified (most selective)
    if (options.type) {
      const typeSet = this.machinesByType.get(options.type);
      candidates = typeSet ? Array.from(typeSet) : [];
    } else {
      // Get all registrations from all types
      candidates = Array.from(this.machinesById.values());
    }

    // Apply additional filters
    let filtered = candidates;

    if (options.registeredAfter) {
      const after = options.registeredAfter;
      filtered = filtered.filter((reg) => reg.registeredAt >= after);
    }

    if (options.registeredBefore) {
      const before = options.registeredBefore;
      filtered = filtered.filter((reg) => reg.registeredAt <= before);
    }

    if (options.includeAnonymous === false) {
      filtered = filtered.filter((reg) => reg.type !== 'anonymous');
    }

    // Apply limit for performance
    if (options.limit && options.limit > 0) {
      filtered = filtered.slice(0, options.limit);
    }

    const elapsedTime = performance.now() - startTime;
    this.totalLookupTime += elapsedTime;

    log.debug(`Discovered ${filtered.length} machines in ${elapsedTime.toFixed(2)}ms`);

    return filtered;
  }

  /**
   * Get all machines of a specific type
   * Optimized for type-based queries
   */
  public getMachinesByType(type: string): MachineRegistration[] {
    const startTime = performance.now();
    this.lookupCount++;

    const typeSet = this.machinesByType.get(type);
    const results = typeSet ? Array.from(typeSet) : [];

    const elapsedTime = performance.now() - startTime;
    this.totalLookupTime += elapsedTime;

    return results;
  }

  /**
   * Unregister a machine and cleanup all references
   * Important for memory management in long-running applications
   */
  public unregister(id: string): boolean {
    const registration = this.machinesById.get(id);
    if (!registration) {
      return false;
    }

    // Remove from all indexes
    this.machinesByBehavior.delete(registration.behavior);
    this.machinesById.delete(id);
    this.machinesBySymbol.delete(registration.symbolId);

    // Remove from type index
    const typeSet = this.machinesByType.get(registration.type);
    if (typeSet) {
      typeSet.delete(registration);
      if (typeSet.size === 0) {
        this.machinesByType.delete(registration.type);
      }
    }

    log.debug(`Unregistered machine: ${registration.type} (${id})`);
    return true;
  }

  /**
   * Get comprehensive registry statistics
   * Useful for monitoring and performance optimization
   */
  public getStats(): RegistryStats {
    const registrationsByType: Record<string, number> = {};
    for (const [type, set] of this.machinesByType) {
      registrationsByType[type] = set.size;
    }

    return {
      totalRegistrations: this.registrationCount,
      totalLookups: this.lookupCount,
      activeRegistrations: this.machinesById.size,
      registrationsByType,
      averageLookupTime: this.lookupCount > 0 ? this.totalLookupTime / this.lookupCount : 0,
      memoryUsage: {
        behaviorMappings: this.machinesById.size, // WeakMap size not directly available
        idMappings: this.machinesById.size,
        typeMappings: this.machinesByType.size,
      },
    };
  }

  /**
   * Clear all registrations (for testing and cleanup)
   * Use with caution in production
   */
  public clear(): void {
    // Clear all Map-based storage
    this.machinesById.clear();
    this.machinesByType.clear();
    this.machinesBySymbol.clear();

    // Note: WeakMap will be garbage collected automatically when behaviors are no longer referenced

    this.registrationCount = 0;
    this.lookupCount = 0;
    this.totalLookupTime = 0;

    log.info('Cleared all machine registrations');
  }

  /**
   * Perform maintenance operations for long-running applications
   * Cleans up stale references and optimizes performance
   */
  public performMaintenance(): void {
    const startTime = performance.now();
    let cleanedCount = 0;

    // Clean up empty type sets
    for (const [type, set] of this.machinesByType) {
      if (set.size === 0) {
        this.machinesByType.delete(type);
        cleanedCount++;
      }
    }

    const elapsedTime = performance.now() - startTime;
    log.info(
      `Maintenance completed: cleaned ${cleanedCount} entries in ${elapsedTime.toFixed(2)}ms`
    );
  }
}

/**
 * Utility functions for working with the machine registry
 */

/**
 * Get machine from behavior using the global registry
 * Convenience function for the most common use case
 */
export function getMachineFromBehavior<TMessage, TEmitted>(
  behavior: ActorBehavior<TMessage, TEmitted>
): AnyStateMachine | undefined {
  const registry = SymbolBasedMachineRegistry.getInstance();
  const registration = registry.getMachineByBehavior(behavior as ActorBehavior<unknown, unknown>);
  return registration?.machine;
}

/**
 * Register machine with behavior using the global registry
 * Convenience function for registration
 */
export function registerMachineWithBehavior<TMessage, TEmitted>(
  behavior: ActorBehavior<TMessage, TEmitted>,
  machine: AnyStateMachine
): MachineRegistration {
  const registry = SymbolBasedMachineRegistry.getInstance();
  return registry.register(behavior as ActorBehavior<unknown, unknown>, machine);
}

/**
 * Check if behavior has an associated machine
 * Fast existence check without full registration lookup
 */
export function behaviorHasMachine<TMessage, TEmitted>(
  behavior: ActorBehavior<TMessage, TEmitted>
): boolean {
  // Use symbol-based check for performance
  return (behavior as unknown as Record<symbol, unknown>)[ActorSymbols.MACHINE] !== undefined;
}

/**
 * Export the singleton instance for direct access
 */
export const machineRegistry = SymbolBasedMachineRegistry.getInstance();
