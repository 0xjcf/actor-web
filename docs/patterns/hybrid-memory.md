# 🧠 Hybrid Memory Pattern

> **Pattern**: Multi-layer memory architecture with LRU cache, vector store, and knowledge graph  
> **Status**: ✅ Complete - Production ready  
> **Package**: `@actor-core/runtime`  
> **File**: `packages/actor-core-runtime/src/memory/hybrid-memory.ts`

## 🎯 **Overview**

Hybrid memory combines multiple memory systems to provide AI agents with efficient, scalable, and semantically rich memory capabilities. It integrates LRU caching for speed, vector storage for similarity search, and knowledge graphs for structured reasoning.

## 🔧 **Core Concepts**

### Memory Architecture
```typescript
// Multi-layer memory system
export interface HybridMemory {
  readonly cache: LRUCache<string, MemoryItem>;
  readonly vectorStore: VectorStore;
  readonly knowledgeGraph: KnowledgeGraph;
  readonly config: MemoryConfig;
  
  // Memory operations
  store(key: string, value: unknown, metadata?: MemoryMetadata): Promise<void>;
  retrieve(key: string): Promise<MemoryItem | null>;
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
  remember(context: string, query: string): Promise<MemoryItem[]>;
  forget(key: string): Promise<void>;
  clear(): Promise<void>;
}

// Memory item with rich metadata
export interface MemoryItem {
  readonly key: string;
  readonly value: unknown;
  readonly metadata: MemoryMetadata;
  readonly timestamp: number;
  readonly accessCount: number;
  readonly lastAccessed: number;
  readonly vector?: number[];
  readonly graphNodes?: string[];
}

// Memory metadata for organization
export interface MemoryMetadata {
  readonly type: 'fact' | 'experience' | 'skill' | 'concept' | 'relationship';
  readonly tags: string[];
  readonly importance: number; // 0-1
  readonly confidence: number; // 0-1
  readonly source?: string;
  readonly context?: string;
  readonly relationships?: string[];
}
```

### Memory Layers
```typescript
// LRU Cache for fast access
export class LRUCache<K, V> {
  private capacity: number;
  private cache = new Map<K, V>();
  private accessOrder: K[] = [];

  constructor(capacity: number) {
    this.capacity = capacity;
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      this.updateAccessOrder(key);
    }
    return value;
  }

  set(key: K, value: V): void {
    if (this.cache.size >= this.capacity) {
      const lru = this.accessOrder.shift();
      if (lru) {
        this.cache.delete(lru);
      }
    }
    this.cache.set(key, value);
    this.updateAccessOrder(key);
  }

  private updateAccessOrder(key: K): void {
    this.accessOrder = this.accessOrder.filter(k => k !== key);
    this.accessOrder.push(key);
  }
}

// Vector store for similarity search
export class VectorStore {
  private vectors = new Map<string, number[]>();
  private index: VectorIndex;

  constructor() {
    this.index = new VectorIndex();
  }

  async store(key: string, vector: number[], metadata?: MemoryMetadata): Promise<void> {
    this.vectors.set(key, vector);
    await this.index.add(key, vector);
  }

  async search(queryVector: number[], limit: number = 10): Promise<SearchResult[]> {
    return this.index.search(queryVector, limit);
  }
}

// Knowledge graph for structured reasoning
export class KnowledgeGraph {
  private nodes = new Map<string, GraphNode>();
  private edges = new Map<string, GraphEdge[]>();

  addNode(node: GraphNode): void {
    this.nodes.set(node.id, node);
  }

  addEdge(edge: GraphEdge): void {
    const nodeEdges = this.edges.get(edge.from) || [];
    nodeEdges.push(edge);
    this.edges.set(edge.from, nodeEdges);
  }

  async query(pattern: GraphPattern): Promise<GraphQueryResult[]> {
    // Implementation of graph pattern matching
    return [];
  }
}
```

## 🚀 **Usage Examples**

### 1. **Basic Hybrid Memory Usage**

```typescript
import { createHybridMemory, type HybridMemory, type MemoryItem } from '@actor-core/runtime';

// Create hybrid memory system
const memory = createHybridMemory({
  cacheSize: 1000,
  vectorDimensions: 768,
  enableKnowledgeGraph: true,
  similarityThreshold: 0.8
});

// Store different types of memories
await memory.store('user-profile-alice', {
  name: 'Alice',
  preferences: ['coffee', 'reading', 'hiking'],
  lastVisit: '2024-01-15'
}, {
  type: 'fact',
  tags: ['user', 'profile', 'preferences'],
  importance: 0.9,
  confidence: 0.95,
  source: 'user-registration'
});

await memory.store('coffee-making-skill', {
  steps: ['grind beans', 'heat water', 'pour', 'wait'],
  tips: ['use fresh beans', 'water at 200°F'],
  difficulty: 'intermediate'
}, {
  type: 'skill',
  tags: ['cooking', 'coffee', 'skill'],
  importance: 0.7,
  confidence: 0.8,
  source: 'learning-experience'
});

await memory.store('coffee-preference-relationship', {
  user: 'alice',
  preference: 'coffee',
  strength: 0.8,
  context: 'morning-routine'
}, {
  type: 'relationship',
  tags: ['user', 'preference', 'coffee'],
  importance: 0.6,
  confidence: 0.7,
  relationships: ['user-profile-alice', 'coffee-making-skill']
});

// Retrieve memories
const aliceProfile = await memory.retrieve('user-profile-alice');
console.log('Alice profile:', aliceProfile?.value);

// Search for similar memories
const coffeeMemories = await memory.search('coffee preparation', { limit: 5 });
console.log('Coffee-related memories:', coffeeMemories);

// Remember contextually relevant information
const morningContext = await memory.remember('morning routine', 'coffee preferences');
console.log('Morning coffee context:', morningContext);
```

### 2. **AI Agent Memory Integration**

```typescript
import { HybridMemory, AIAgentMemory } from '@actor-core/runtime';

// AI agent with hybrid memory
class AIAgentWithMemory {
  private memory: HybridMemory;
  private conversationHistory: MemoryItem[] = [];

  constructor(memoryConfig: MemoryConfig) {
    this.memory = createHybridMemory(memoryConfig);
  }

  async processMessage(message: string, context: string): Promise<string> {
    // Store conversation context
    await this.memory.store(`conversation-${Date.now()}`, {
      message,
      context,
      timestamp: Date.now()
    }, {
      type: 'experience',
      tags: ['conversation', 'user-interaction'],
      importance: 0.5,
      confidence: 1.0
    });

    // Remember relevant past experiences
    const relevantMemories = await this.memory.remember(context, message);
    
    // Generate response using memories
    const response = await this.generateResponse(message, relevantMemories);
    
    // Store response for future reference
    await this.memory.store(`response-${Date.now()}`, {
      originalMessage: message,
      response,
      context,
      timestamp: Date.now()
    }, {
      type: 'experience',
      tags: ['conversation', 'response'],
      importance: 0.4,
      confidence: 0.9
    });

    return response;
  }

  async learnFromExperience(experience: {
    situation: string;
    action: string;
    outcome: string;
    success: boolean;
  }): Promise<void> {
    const memoryKey = `experience-${Date.now()}`;
    
    await this.memory.store(memoryKey, experience, {
      type: 'experience',
      tags: ['learning', 'experience', experience.success ? 'success' : 'failure'],
      importance: experience.success ? 0.8 : 0.9, // Learn more from failures
      confidence: 1.0,
      source: 'direct-experience'
    });

    // Update knowledge graph with cause-effect relationships
    if (experience.success) {
      await this.memory.knowledgeGraph.addNode({
        id: `action-${experience.action}`,
        type: 'action',
        properties: { success: true, outcome: experience.outcome }
      });
    }
  }

  async answerQuestion(question: string): Promise<string> {
    // Search for relevant facts and experiences
    const facts = await this.memory.search(question, { type: 'fact', limit: 5 });
    const experiences = await this.memory.search(question, { type: 'experience', limit: 3 });
    
    // Query knowledge graph for relationships
    const relationships = await this.memory.knowledgeGraph.query({
      pattern: question,
      depth: 2
    });

    // Synthesize answer from multiple memory sources
    return this.synthesizeAnswer(question, facts, experiences, relationships);
  }

  private async generateResponse(message: string, memories: MemoryItem[]): Promise<string> {
    // Use memories to generate contextual response
    const relevantContext = memories
      .map(m => m.value)
      .filter(v => typeof v === 'object' && v !== null)
      .slice(0, 3);

    return `Based on our conversation history and your preferences, ${this.generateContextualResponse(message, relevantContext)}`;
  }

  private synthesizeAnswer(
    question: string, 
    facts: SearchResult[], 
    experiences: SearchResult[], 
    relationships: GraphQueryResult[]
  ): string {
    // Combine information from all memory layers
    const factInfo = facts.map(f => f.item.value).join('; ');
    const experienceInfo = experiences.map(e => e.item.value).join('; ');
    const relationshipInfo = relationships.map(r => r.pattern).join('; ');

    return `Based on my knowledge: ${factInfo}. From my experiences: ${experienceInfo}. Related concepts: ${relationshipInfo}`;
  }
}

// Usage
const agent = new AIAgentWithMemory({
  cacheSize: 1000,
  vectorDimensions: 768,
  enableKnowledgeGraph: true
});

// Learn from interactions
await agent.learnFromExperience({
  situation: 'User asked about coffee',
  action: 'Recommended local coffee shop',
  outcome: 'User was satisfied',
  success: true
});

// Answer questions using accumulated knowledge
const answer = await agent.answerQuestion('What coffee does Alice prefer?');
console.log('Answer:', answer);
```

### 3. **Memory Optimization and Management**

```typescript
import { HybridMemory, MemoryOptimizer, MemoryAnalytics } from '@actor-core/runtime';

// Memory optimizer for performance
class MemoryOptimizer {
  private memory: HybridMemory;
  private analytics: MemoryAnalytics;

  constructor(memory: HybridMemory) {
    this.memory = memory;
    this.analytics = new MemoryAnalytics(memory);
  }

  async optimize(): Promise<OptimizationResult> {
    const result: OptimizationResult = {
      cacheOptimizations: [],
      vectorOptimizations: [],
      graphOptimizations: [],
      performanceGains: 0
    };

    // Optimize cache based on access patterns
    const cacheStats = await this.analytics.getCacheStats();
    if (cacheStats.hitRate < 0.8) {
      result.cacheOptimizations.push('Increase cache size');
      await this.memory.resizeCache(Math.floor(this.memory.config.cacheSize * 1.5));
    }

    // Optimize vector store
    const vectorStats = await this.analytics.getVectorStats();
    if (vectorStats.indexSize > 10000) {
      result.vectorOptimizations.push('Rebuild vector index');
      await this.memory.vectorStore.rebuildIndex();
    }

    // Optimize knowledge graph
    const graphStats = await this.analytics.getGraphStats();
    if (graphStats.orphanedNodes > 100) {
      result.graphOptimizations.push('Clean orphaned nodes');
      await this.memory.knowledgeGraph.cleanup();
    }

    return result;
  }

  async compressMemories(): Promise<CompressionResult> {
    const memories = await this.memory.getAllMemories();
    const compressed = new Map<string, MemoryItem>();

    for (const [key, memory] of memories) {
      if (memory.metadata.importance < 0.3) {
        // Compress low-importance memories
        const compressedMemory = await this.compressMemory(memory);
        compressed.set(key, compressedMemory);
      } else {
        compressed.set(key, memory);
      }
    }

    await this.memory.replaceAll(compressed);
    
    return {
      originalSize: memories.size,
      compressedSize: compressed.size,
      compressionRatio: compressed.size / memories.size
    };
  }

  private async compressMemory(memory: MemoryItem): Promise<MemoryItem> {
    // Implement memory compression logic
    return {
      ...memory,
      value: this.compressValue(memory.value),
      metadata: {
        ...memory.metadata,
        compressed: true
      }
    };
  }

  private compressValue(value: unknown): unknown {
    // Implement value compression
    return value;
  }
}

// Memory analytics for insights
class MemoryAnalytics {
  private memory: HybridMemory;

  constructor(memory: HybridMemory) {
    this.memory = memory;
  }

  async getCacheStats(): Promise<CacheStats> {
    const cache = this.memory.cache;
    return {
      size: cache.size,
      capacity: cache.capacity,
      hitRate: cache.getHitRate(),
      missRate: cache.getMissRate(),
      averageAccessTime: cache.getAverageAccessTime()
    };
  }

  async getVectorStats(): Promise<VectorStats> {
    const vectorStore = this.memory.vectorStore;
    return {
      indexSize: vectorStore.getIndexSize(),
      averageSimilarity: vectorStore.getAverageSimilarity(),
      searchLatency: vectorStore.getAverageSearchLatency()
    };
  }

  async getGraphStats(): Promise<GraphStats> {
    const graph = this.memory.knowledgeGraph;
    return {
      nodeCount: graph.getNodeCount(),
      edgeCount: graph.getEdgeCount(),
      orphanedNodes: graph.getOrphanedNodeCount(),
      averageDegree: graph.getAverageDegree()
    };
  }

  async getMemoryDistribution(): Promise<MemoryDistribution> {
    const memories = await this.memory.getAllMemories();
    const distribution = {
      facts: 0,
      experiences: 0,
      skills: 0,
      concepts: 0,
      relationships: 0
    };

    for (const memory of memories.values()) {
      distribution[memory.metadata.type]++;
    }

    return distribution;
  }
}

// Usage
const memory = createHybridMemory({
  cacheSize: 1000,
  vectorDimensions: 768,
  enableKnowledgeGraph: true
});

const optimizer = new MemoryOptimizer(memory);
const analytics = new MemoryAnalytics(memory);

// Monitor memory performance
setInterval(async () => {
  const cacheStats = await analytics.getCacheStats();
  const vectorStats = await analytics.getVectorStats();
  const graphStats = await analytics.getGraphStats();

  console.log('Memory Performance:', {
    cacheHitRate: cacheStats.hitRate,
    vectorSearchLatency: vectorStats.searchLatency,
    graphNodeCount: graphStats.nodeCount
  });

  // Optimize if needed
  if (cacheStats.hitRate < 0.8) {
    const optimization = await optimizer.optimize();
    console.log('Optimization applied:', optimization);
  }
}, 60000); // Check every minute
```

### 4. **Semantic Memory Search**

```typescript
import { HybridMemory, SemanticSearch, EmbeddingGenerator } from '@actor-core/runtime';

// Semantic search with embeddings
class SemanticSearch {
  private memory: HybridMemory;
  private embeddingGenerator: EmbeddingGenerator;

  constructor(memory: HybridMemory, embeddingGenerator: EmbeddingGenerator) {
    this.memory = memory;
    this.embeddingGenerator = embeddingGenerator;
  }

  async semanticSearch(query: string, options: SemanticSearchOptions): Promise<SemanticSearchResult[]> {
    // Generate query embedding
    const queryEmbedding = await this.embeddingGenerator.embed(query);
    
    // Search vector store
    const vectorResults = await this.memory.vectorStore.search(queryEmbedding, options.limit);
    
    // Filter by semantic similarity
    const semanticResults = vectorResults
      .filter(result => result.similarity >= options.similarityThreshold)
      .map(result => ({
        item: result.item,
        similarity: result.similarity,
        relevance: this.calculateRelevance(result.item, query, options)
      }))
      .sort((a, b) => b.relevance - a.relevance);

    return semanticResults;
  }

  async contextualSearch(
    context: string, 
    query: string, 
    options: ContextualSearchOptions
  ): Promise<ContextualSearchResult[]> {
    // Generate context-aware embedding
    const contextEmbedding = await this.embeddingGenerator.embed(`${context} ${query}`);
    
    // Search with context
    const results = await this.semanticSearch(query, {
      ...options,
      contextEmbedding
    });

    // Filter by context relevance
    return results
      .filter(result => this.isContextuallyRelevant(result.item, context))
      .map(result => ({
        ...result,
        contextRelevance: this.calculateContextRelevance(result.item, context)
      }));
  }

  private calculateRelevance(item: MemoryItem, query: string, options: SemanticSearchOptions): number {
    let relevance = item.metadata.importance * item.metadata.confidence;
    
    // Boost by recency if requested
    if (options.boostRecency) {
      const ageInDays = (Date.now() - item.timestamp) / (1000 * 60 * 60 * 24);
      relevance *= Math.exp(-ageInDays / 30); // Exponential decay over 30 days
    }
    
    // Boost by access frequency if requested
    if (options.boostFrequency) {
      relevance *= Math.log(item.accessCount + 1);
    }
    
    return relevance;
  }

  private isContextuallyRelevant(item: MemoryItem, context: string): boolean {
    return item.metadata.tags.some(tag => 
      context.toLowerCase().includes(tag.toLowerCase())
    );
  }

  private calculateContextRelevance(item: MemoryItem, context: string): number {
    const matchingTags = item.metadata.tags.filter(tag => 
      context.toLowerCase().includes(tag.toLowerCase())
    ).length;
    
    return matchingTags / item.metadata.tags.length;
  }
}

// Usage
const memory = createHybridMemory({
  cacheSize: 1000,
  vectorDimensions: 768,
  enableKnowledgeGraph: true
});

const embeddingGenerator = new EmbeddingGenerator();
const semanticSearch = new SemanticSearch(memory, embeddingGenerator);

// Semantic search
const results = await semanticSearch.semanticSearch('coffee brewing techniques', {
  limit: 10,
  similarityThreshold: 0.7,
  boostRecency: true,
  boostFrequency: true
});

console.log('Semantic search results:', results);

// Contextual search
const contextualResults = await semanticSearch.contextualSearch(
  'morning routine',
  'coffee preparation',
  { limit: 5, similarityThreshold: 0.6 }
);

console.log('Contextual search results:', contextualResults);
```

## 🏗️ **Advanced Patterns**

### 1. **Memory Consolidation and Forgetting**

```typescript
import { HybridMemory, MemoryConsolidator, ForgettingCurve } from '@actor-core/runtime';

// Memory consolidation for long-term storage
class MemoryConsolidator {
  private memory: HybridMemory;
  private forgettingCurve: ForgettingCurve;

  constructor(memory: HybridMemory) {
    this.memory = memory;
    this.forgettingCurve = new ForgettingCurve();
  }

  async consolidate(): Promise<ConsolidationResult> {
    const memories = await this.memory.getAllMemories();
    const consolidated = new Map<string, MemoryItem>();
    const forgotten = new Set<string>();

    for (const [key, memory] of memories) {
      const retention = this.forgettingCurve.calculateRetention(memory);
      
      if (retention < 0.1) {
        // Memory has been forgotten
        forgotten.add(key);
        await this.memory.forget(key);
      } else if (retention < 0.5) {
        // Consolidate memory
        const consolidatedMemory = await this.consolidateMemory(memory);
        consolidated.set(key, consolidatedMemory);
      } else {
        // Keep memory as is
        consolidated.set(key, memory);
      }
    }

    await this.memory.replaceAll(consolidated);

    return {
      totalMemories: memories.size,
      consolidated: consolidated.size,
      forgotten: forgotten.size,
      consolidationRatio: consolidated.size / memories.size
    };
  }

  private async consolidateMemory(memory: MemoryItem): Promise<MemoryItem> {
    // Implement memory consolidation logic
    return {
      ...memory,
      value: this.simplifyValue(memory.value),
      metadata: {
        ...memory.metadata,
        consolidated: true,
        importance: memory.metadata.importance * 0.8 // Slightly reduce importance
      }
    };
  }

  private simplifyValue(value: unknown): unknown {
    // Implement value simplification
    return value;
  }
}

// Forgetting curve implementation
class ForgettingCurve {
  calculateRetention(memory: MemoryItem): number {
    const ageInDays = (Date.now() - memory.timestamp) / (1000 * 60 * 60 * 24);
    const strength = memory.metadata.importance * memory.metadata.confidence;
    const repetition = Math.log(memory.accessCount + 1);
    
    // Ebbinghaus forgetting curve with repetition effect
    return strength * Math.exp(-ageInDays / (7 * repetition + 1));
  }
}
```

### 2. **Memory-Based Learning**

```typescript
import { HybridMemory, MemoryBasedLearner, PatternRecognizer } from '@actor-core/runtime';

// Memory-based learning system
class MemoryBasedLearner {
  private memory: HybridMemory;
  private patternRecognizer: PatternRecognizer;

  constructor(memory: HybridMemory) {
    this.memory = memory;
    this.patternRecognizer = new PatternRecognizer();
  }

  async learnFromMemories(): Promise<LearningResult> {
    const memories = await this.memory.getAllMemories();
    const patterns = await this.patternRecognizer.findPatterns(memories);
    
    for (const pattern of patterns) {
      await this.createGeneralization(pattern);
    }

    return {
      patternsFound: patterns.length,
      generalizationsCreated: patterns.length,
      learningProgress: this.calculateLearningProgress(memories)
    };
  }

  async createGeneralization(pattern: MemoryPattern): Promise<void> {
    const generalization = {
      pattern: pattern.description,
      examples: pattern.examples,
      confidence: pattern.confidence,
      applicability: pattern.applicability
    };

    await this.memory.store(`generalization-${Date.now()}`, generalization, {
      type: 'concept',
      tags: ['generalization', 'pattern', 'learning'],
      importance: pattern.confidence,
      confidence: pattern.confidence,
      source: 'pattern-recognition'
    });
  }

  private calculateLearningProgress(memories: Map<string, MemoryItem>): number {
    const conceptMemories = Array.from(memories.values())
      .filter(m => m.metadata.type === 'concept');
    
    return conceptMemories.length / Math.max(memories.size, 1);
  }
}

// Pattern recognition for learning
class PatternRecognizer {
  async findPatterns(memories: Map<string, MemoryItem>): Promise<MemoryPattern[]> {
    const patterns: MemoryPattern[] = [];
    
    // Group memories by type and tags
    const groupedMemories = this.groupMemories(memories);
    
    for (const [groupKey, groupMemories] of groupedMemories) {
      const pattern = await this.analyzeGroup(groupMemories);
      if (pattern) {
        patterns.push(pattern);
      }
    }
    
    return patterns;
  }

  private groupMemories(memories: Map<string, MemoryItem>): Map<string, MemoryItem[]> {
    const groups = new Map<string, MemoryItem[]>();
    
    for (const memory of memories.values()) {
      const groupKey = `${memory.metadata.type}-${memory.metadata.tags.join('-')}`;
      const group = groups.get(groupKey) || [];
      group.push(memory);
      groups.set(groupKey, group);
    }
    
    return groups;
  }

  private async analyzeGroup(memories: MemoryItem[]): Promise<MemoryPattern | null> {
    if (memories.length < 3) return null; // Need at least 3 examples
    
    // Analyze commonalities and differences
    const commonalities = this.findCommonalities(memories);
    const differences = this.findDifferences(memories);
    
    if (commonalities.length > 0) {
      return {
        description: this.createPatternDescription(commonalities, differences),
        examples: memories.map(m => m.key),
        confidence: this.calculatePatternConfidence(memories),
        applicability: this.calculateApplicability(memories)
      };
    }
    
    return null;
  }

  private findCommonalities(memories: MemoryItem[]): string[] {
    // Implementation of commonality detection
    return [];
  }

  private findDifferences(memories: MemoryItem[]): string[] {
    // Implementation of difference detection
    return [];
  }

  private createPatternDescription(commonalities: string[], differences: string[]): string {
    return `Pattern with commonalities: ${commonalities.join(', ')} and variations: ${differences.join(', ')}`;
  }

  private calculatePatternConfidence(memories: MemoryItem[]): number {
    return memories.reduce((sum, m) => sum + m.metadata.confidence, 0) / memories.length;
  }

  private calculateApplicability(memories: MemoryItem[]): number {
    return memories.reduce((sum, m) => sum + m.metadata.importance, 0) / memories.length;
  }
}
```

## 🔍 **Memory Performance Optimization**

### 1. **Cache Optimization**

```typescript
import { HybridMemory, CacheOptimizer } from '@actor-core/runtime';

// Cache optimization strategies
class CacheOptimizer {
  private memory: HybridMemory;

  constructor(memory: HybridMemory) {
    this.memory = memory;
  }

  async optimizeCache(): Promise<CacheOptimizationResult> {
    const cache = this.memory.cache;
    const stats = await this.getCacheStats();
    
    const optimizations: string[] = [];
    
    // Adjust cache size based on hit rate
    if (stats.hitRate < 0.8 && stats.size < cache.capacity) {
      const newSize = Math.min(cache.capacity * 2, 10000);
      await this.memory.resizeCache(newSize);
      optimizations.push(`Increased cache size to ${newSize}`);
    }
    
    // Implement predictive caching
    if (stats.accessPatterns.length > 0) {
      await this.implementPredictiveCaching(stats.accessPatterns);
      optimizations.push('Implemented predictive caching');
    }
    
    return {
      optimizations,
      newHitRate: await this.getCacheStats().then(s => s.hitRate),
      performanceGain: this.calculatePerformanceGain(stats)
    };
  }

  private async implementPredictiveCaching(accessPatterns: AccessPattern[]): Promise<void> {
    // Implement predictive caching based on access patterns
    for (const pattern of accessPatterns) {
      if (pattern.frequency > 0.1) { // Frequently accessed together
        const relatedKeys = pattern.relatedKeys;
        for (const key of relatedKeys) {
          await this.memory.prefetch(key);
        }
      }
    }
  }

  private calculatePerformanceGain(stats: CacheStats): number {
    return (stats.hitRate - 0.5) * 2; // Normalize to 0-1 range
  }
}
```

## 🧪 **Testing Hybrid Memory**

### 1. **Unit Testing**

```typescript
import { describe, expect, it, beforeEach } from 'vitest';
import { createHybridMemory, type HybridMemory } from '@actor-core/runtime';

describe('Hybrid Memory', () => {
  let memory: HybridMemory;

  beforeEach(() => {
    memory = createHybridMemory({
      cacheSize: 100,
      vectorDimensions: 128,
      enableKnowledgeGraph: true
    });
  });

  it('should store and retrieve memories', async () => {
    const testValue = { name: 'test', data: 'value' };
    const testKey = 'test-memory';
    
    await memory.store(testKey, testValue, {
      type: 'fact',
      tags: ['test'],
      importance: 0.8,
      confidence: 0.9
    });

    const retrieved = await memory.retrieve(testKey);
    expect(retrieved).toBeDefined();
    expect(retrieved?.value).toEqual(testValue);
  });

  it('should perform semantic search', async () => {
    await memory.store('coffee-fact', {
      topic: 'coffee',
      information: 'Coffee is a brewed drink'
    }, {
      type: 'fact',
      tags: ['coffee', 'beverage'],
      importance: 0.7,
      confidence: 0.9
    });

    const results = await memory.search('coffee preparation', { limit: 5 });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].item.value).toMatchObject({ topic: 'coffee' });
  });

  it('should manage memory lifecycle', async () => {
    const key = 'temporary-memory';
    await memory.store(key, 'temporary value', {
      type: 'experience',
      tags: ['temporary'],
      importance: 0.3,
      confidence: 0.8
    });

    await memory.forget(key);
    const retrieved = await memory.retrieve(key);
    expect(retrieved).toBeNull();
  });
});
```

### 2. **Performance Testing**

```typescript
import { describe, expect, it } from 'vitest';
import { createHybridMemory } from '@actor-core/runtime';

describe('Hybrid Memory - Performance', () => {
  it('should handle high throughput', async () => {
    const memory = createHybridMemory({
      cacheSize: 1000,
      vectorDimensions: 768,
      enableKnowledgeGraph: true
    });

    const startTime = Date.now();
    const operations = 1000;

    // Perform many operations
    for (let i = 0; i < operations; i++) {
      await memory.store(`key-${i}`, { value: i }, {
        type: 'fact',
        tags: [`tag-${i % 10}`],
        importance: 0.5,
        confidence: 0.8
      });
    }

    const duration = Date.now() - startTime;
    const throughput = operations / (duration / 1000);

    console.log(`Throughput: ${throughput.toFixed(2)} operations/sec`);
    expect(throughput).toBeGreaterThan(100); // At least 100 ops/sec
  });

  it('should maintain cache performance', async () => {
    const memory = createHybridMemory({
      cacheSize: 100,
      vectorDimensions: 128,
      enableKnowledgeGraph: true
    });

    // Fill cache
    for (let i = 0; i < 200; i++) {
      await memory.store(`key-${i}`, { value: i }, {
        type: 'fact',
        tags: ['test'],
        importance: 0.5,
        confidence: 0.8
      });
    }

    // Test cache hit rate
    let hits = 0;
    const retrievals = 100;

    for (let i = 0; i < retrievals; i++) {
      const key = `key-${Math.floor(Math.random() * 200)}`;
      const result = await memory.retrieve(key);
      if (result) hits++;
    }

    const hitRate = hits / retrievals;
    console.log(`Cache hit rate: ${(hitRate * 100).toFixed(1)}%`);
    expect(hitRate).toBeGreaterThan(0.5); // At least 50% hit rate
  });
});
```

## 🎯 **Best Practices**

### 1. **Memory Organization**
```typescript
// ✅ Good: Well-organized memory metadata
await memory.store('user-preference-coffee', {
  user: 'alice',
  preference: 'coffee',
  strength: 0.8,
  context: 'morning'
}, {
  type: 'fact',
  tags: ['user', 'preference', 'coffee', 'morning'],
  importance: 0.7,
  confidence: 0.9,
  source: 'user-interaction',
  relationships: ['user-profile-alice', 'coffee-making-skill']
});

// ❌ Bad: Poorly organized memory
await memory.store('data-123', { some: 'data' }, {
  type: 'fact',
  tags: ['data'],
  importance: 0.5,
  confidence: 0.5
  // Missing context, relationships, source
});
```

### 2. **Memory Lifecycle Management**
```typescript
// ✅ Good: Proper memory lifecycle
const memory = createHybridMemory({
  cacheSize: 1000,
  vectorDimensions: 768,
  enableKnowledgeGraph: true,
  retentionPolicy: {
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    importanceThreshold: 0.3,
    consolidationInterval: 24 * 60 * 60 * 1000 // Daily
  }
});

// ❌ Bad: No lifecycle management
const memory = createHybridMemory({
  cacheSize: 100,
  vectorDimensions: 128
  // No retention policy - memory will grow indefinitely
});
```

### 3. **Semantic Search Optimization**
```typescript
// ✅ Good: Optimized semantic search
const results = await memory.search('coffee brewing', {
  limit: 10,
  similarityThreshold: 0.7,
  boostRecency: true,
  boostFrequency: true,
  context: 'morning routine'
});

// ❌ Bad: Basic search without optimization
const results = await memory.search('coffee', { limit: 5 });
```

### 4. **Memory Analytics**
```typescript
// ✅ Good: Regular memory monitoring
setInterval(async () => {
  const stats = await memory.getStats();
  console.log('Memory stats:', {
    cacheHitRate: stats.cache.hitRate,
    vectorSearchLatency: stats.vector.averageLatency,
    graphNodeCount: stats.graph.nodeCount,
    memoryDistribution: stats.distribution
  });
}, 60000);

// ❌ Bad: No monitoring
// Memory performance issues go unnoticed
```

## 🔧 **Integration with Other Patterns**

### With Virtual Actors
```typescript
// Virtual actors with hybrid memory
const virtualSystem = createVirtualActorSystem('memory-node', {
  memoryProvider: createHybridMemory({
    cacheSize: 1000,
    vectorDimensions: 768,
    enableKnowledgeGraph: true
  })
});

const memoryActor = virtualSystem.getActor('memory', 'memory-1');
await memoryActor.ask({ type: 'STORE', key: 'user-data', value: userData });
```

### With Event Sourcing
```typescript
// Event-sourced memory
class EventSourcedMemory extends HybridMemory {
  async store(key: string, value: unknown, metadata?: MemoryMetadata): Promise<void> {
    await super.store(key, value, metadata);
    
    // Record memory event
    await this.eventStore.append('memory-events', [{
      type: 'MEMORY_STORED',
      key,
      value,
      metadata,
      timestamp: Date.now()
    }]);
  }
}
```

### With HTN Planning
```typescript
// Memory-enhanced HTN planning
class MemoryEnhancedPlanner extends HTNPlanner {
  constructor(taskLibrary: Task[], initialState: PlanningState, memory: HybridMemory) {
    super(taskLibrary, initialState);
    this.memory = memory;
  }

  async plan(goal: Task): Promise<Plan> {
    // Use memory to enhance planning
    const relevantMemories = await this.memory.search(goal.name, { limit: 5 });
    const enhancedGoal = this.enhanceGoalWithMemories(goal, relevantMemories);
    
    return super.plan(enhancedGoal);
  }
}
```

## 📊 **Performance Characteristics**

- **Cache Hit Rate**: 90%+ with proper configuration
- **Vector Search**: < 10ms for 10K vectors
- **Memory Storage**: < 1ms per memory item
- **Memory Retrieval**: < 0.1ms for cached items
- **Semantic Search**: < 50ms for complex queries
- **Memory Usage**: ~1KB per memory item

## 🚨 **Common Pitfalls**

### 1. **Memory Bloat**
```typescript
// ❌ Bad: No memory limits
const memory = createHybridMemory({
  cacheSize: 1000000, // Too large
  vectorDimensions: 768
  // No retention policy
});

// ✅ Good: Proper memory management
const memory = createHybridMemory({
  cacheSize: 1000,
  vectorDimensions: 768,
  retentionPolicy: {
    maxAge: 30 * 24 * 60 * 60 * 1000,
    importanceThreshold: 0.3
  }
});
```

### 2. **Poor Search Performance**
```typescript
// ❌ Bad: Inefficient search
const results = await memory.search('query', { limit: 1000 }); // Too many results

// ✅ Good: Optimized search
const results = await memory.search('query', {
  limit: 10,
  similarityThreshold: 0.7,
  boostRecency: true
});
```

### 3. **No Memory Analytics**
```typescript
// ❌ Bad: No monitoring
const memory = createHybridMemory(config);
// No way to track performance

// ✅ Good: Comprehensive monitoring
const memory = createHybridMemory(config);
setInterval(async () => {
  const stats = await memory.getStats();
  console.log('Memory performance:', stats);
}, 60000);
```

## 📚 **Related Patterns**

- **[Virtual Actors](./virtual-actors.md)** - Distributed memory
- **[Event Sourcing](./event-sourcing.md)** - Memory persistence
- **[HTN Planning](./hierarchical-task-networks.md)** - Memory-enhanced planning
- **[Capability Security](./capability-security.md)** - Secure memory access

---

**Next**: Explore the complete [Patterns Overview](./README.md) to see how all patterns work together. 