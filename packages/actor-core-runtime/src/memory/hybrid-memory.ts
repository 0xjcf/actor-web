/**
 * @module actor-core/runtime/memory/hybrid-memory
 * @description Hybrid memory architecture for autonomous agents with layered storage
 * @author Agent A (Tech Lead) - 2025-07-17
 */

import { Logger } from '../logger.js';

// ========================================================================================
// MEMORY CORE TYPES
// ========================================================================================

/**
 * Experience data structure for episodic memory
 */
export interface Experience {
  /**
   * Unique identifier for the experience
   */
  id: string;

  /**
   * Content of the experience
   */
  content: string;

  /**
   * Timestamp when the experience occurred
   */
  timestamp: number;

  /**
   * Context in which the experience occurred
   */
  context: Record<string, unknown>;

  /**
   * Emotional valence (-1 to 1)
   */
  valence?: number;

  /**
   * Importance score (0 to 1)
   */
  importance: number;

  /**
   * Tags for categorization
   */
  tags: string[];

  /**
   * Metadata for the experience
   */
  metadata?: Record<string, unknown>;
}

/**
 * Memory recall result
 */
export interface Memory {
  /**
   * Type of memory (short-term, episodic, semantic)
   */
  type: 'short-term' | 'episodic' | 'semantic';

  /**
   * Content of the memory
   */
  content: unknown;

  /**
   * Relevance score (0 to 1)
   */
  relevance: number;

  /**
   * Confidence score (0 to 1)
   */
  confidence: number;

  /**
   * Age of the memory (in milliseconds)
   */
  age: number;

  /**
   * Source experience ID (if applicable)
   */
  sourceId?: string;

  /**
   * Associated context
   */
  context?: Record<string, unknown>;
}

/**
 * Semantic knowledge node
 */
export interface SemanticNode {
  /**
   * Unique identifier
   */
  id: string;

  /**
   * Concept or fact
   */
  concept: string;

  /**
   * Related concepts
   */
  relations: Array<{
    target: string;
    relation: string;
    strength: number;
  }>;

  /**
   * Confidence in this knowledge
   */
  confidence: number;

  /**
   * Source experiences that contributed to this knowledge
   */
  sources: string[];

  /**
   * Last update timestamp
   */
  lastUpdated: number;
}

/**
 * Vector embedding for similarity search
 */
export interface VectorEmbedding {
  /**
   * Content identifier
   */
  id: string;

  /**
   * Vector representation
   */
  vector: number[];

  /**
   * Original content
   */
  content: string;

  /**
   * Associated metadata
   */
  metadata: Record<string, unknown>;
}

// ========================================================================================
// MEMORY COMPONENTS
// ========================================================================================

/**
 * LRU Cache for short-term memory
 */
export class LRUCache<K, V> {
  private cache = new Map<K, V>();
  private maxSize: number;
  private logger = Logger.namespace('LRU_CACHE');

  constructor(maxSize = 100) {
    this.maxSize = maxSize;
    this.logger.debug('LRU Cache created', { maxSize });
  }

  /**
   * Get value from cache
   */
  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, value);
      this.logger.debug('Cache hit', { key, size: this.cache.size });
    } else {
      this.logger.debug('Cache miss', { key });
    }
    return value;
  }

  /**
   * Set value in cache
   */
  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Remove least recently used (first item)
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
        this.logger.debug('Cache evicted', { evictedKey: firstKey });
      }
    }

    this.cache.set(key, value);
    this.logger.debug('Cache set', { key, size: this.cache.size });
  }

  /**
   * Check if key exists
   */
  has(key: K): boolean {
    return this.cache.has(key);
  }

  /**
   * Get all values
   */
  values(): V[] {
    return Array.from(this.cache.values());
  }

  /**
   * Get all keys
   */
  keys(): K[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Clear cache
   */
  clear(): void {
    this.cache.clear();
    this.logger.debug('Cache cleared');
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    size: number;
    maxSize: number;
    usage: number;
  } {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      usage: this.cache.size / this.maxSize,
    };
  }
}

/**
 * Vector store for episodic memory with similarity search
 */
export class VectorStore {
  private vectors = new Map<string, VectorEmbedding>();
  private logger = Logger.namespace('VECTOR_STORE');

  constructor() {
    this.logger.debug('Vector store created');
  }

  /**
   * Index an experience with its vector embedding
   */
  async index(experience: Experience): Promise<void> {
    const embedding = await this.generateEmbedding(experience.content);

    this.vectors.set(experience.id, {
      id: experience.id,
      vector: embedding,
      content: experience.content,
      metadata: {
        timestamp: experience.timestamp,
        context: experience.context,
        importance: experience.importance,
        tags: experience.tags,
      },
    });

    this.logger.debug('Experience indexed', {
      id: experience.id,
      vectorSize: embedding.length,
      totalVectors: this.vectors.size,
    });
  }

  /**
   * Search for similar experiences
   */
  async search(
    query: string,
    limit = 10
  ): Promise<Array<{ id: string; similarity: number; content: string }>> {
    const queryVector = await this.generateEmbedding(query);
    const results: Array<{ id: string; similarity: number; content: string }> = [];

    for (const [id, embedding] of this.vectors) {
      const similarity = this.cosineSimilarity(queryVector, embedding.vector);
      results.push({
        id,
        similarity,
        content: embedding.content,
      });
    }

    // Sort by similarity and return top results
    results.sort((a, b) => b.similarity - a.similarity);
    const topResults = results.slice(0, limit);

    this.logger.debug('Vector search completed', {
      query: query.substring(0, 50),
      totalVectors: this.vectors.size,
      resultsReturned: topResults.length,
    });

    return topResults;
  }

  /**
   * Generate embedding for text (simplified implementation)
   */
  private async generateEmbedding(text: string): Promise<number[]> {
    // Simplified embedding generation using character frequencies
    // In a real implementation, this would use a proper embedding model
    const vector = new Array(128).fill(0);

    for (let i = 0; i < text.length; i++) {
      const charCode = text.charCodeAt(i);
      const index = charCode % 128;
      vector[index] += 1;
    }

    // Normalize the vector
    const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    return magnitude > 0 ? vector.map((val) => val / magnitude) : vector;
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Get vector store statistics
   */
  getStats(): {
    totalVectors: number;
    vectorDimensions: number;
  } {
    const firstVector = this.vectors.values().next().value;
    return {
      totalVectors: this.vectors.size,
      vectorDimensions: firstVector?.vector.length || 0,
    };
  }
}

/**
 * Knowledge graph for semantic memory
 */
export class KnowledgeGraph {
  private nodes = new Map<string, SemanticNode>();
  private logger = Logger.namespace('KNOWLEDGE_GRAPH');

  constructor() {
    this.logger.debug('Knowledge graph created');
  }

  /**
   * Extract semantic knowledge from an experience
   */
  async extract(experience: Experience): Promise<void> {
    const concepts = this.extractConcepts(experience.content);

    for (const concept of concepts) {
      await this.addOrUpdateNode(concept, experience);
    }

    this.logger.debug('Knowledge extracted', {
      experienceId: experience.id,
      conceptsExtracted: concepts.length,
      totalNodes: this.nodes.size,
    });
  }

  /**
   * Query the knowledge graph
   */
  async query(
    context: string
  ): Promise<Array<{ concept: string; relevance: number; confidence: number }>> {
    const queryWords = context.toLowerCase().split(/\s+/);
    const results: Array<{ concept: string; relevance: number; confidence: number }> = [];

    for (const [, node] of this.nodes) {
      const relevance = this.calculateRelevance(queryWords, node);
      if (relevance > 0.1) {
        results.push({
          concept: node.concept,
          relevance,
          confidence: node.confidence,
        });
      }
    }

    results.sort((a, b) => b.relevance - a.relevance);

    this.logger.debug('Knowledge query completed', {
      query: context.substring(0, 50),
      totalNodes: this.nodes.size,
      resultsReturned: results.length,
    });

    return results.slice(0, 10);
  }

  /**
   * Extract concepts from text
   */
  private extractConcepts(text: string): string[] {
    // Simplified concept extraction
    // In a real implementation, this would use NLP techniques
    const words = text
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter((word) => word.length > 3);

    // Remove common words and return unique concepts
    const stopWords = new Set([
      'this',
      'that',
      'with',
      'have',
      'will',
      'from',
      'they',
      'them',
      'been',
      'were',
      'said',
      'each',
      'which',
      'their',
      'time',
      'would',
      'there',
      'what',
      'about',
      'when',
      'where',
      'more',
      'some',
      'like',
      'into',
      'after',
      'back',
      'other',
      'many',
      'than',
      'then',
      'them',
      'these',
      'could',
      'should',
      'might',
      'being',
      'doing',
      'having',
    ]);

    return [...new Set(words.filter((word) => !stopWords.has(word)))];
  }

  /**
   * Add or update a semantic node
   */
  private async addOrUpdateNode(concept: string, experience: Experience): Promise<void> {
    const existingNode = this.nodes.get(concept);

    if (existingNode) {
      // Update existing node
      existingNode.confidence = Math.min(1, existingNode.confidence + 0.1);
      existingNode.sources.push(experience.id);
      existingNode.lastUpdated = Date.now();
    } else {
      // Create new node
      const node: SemanticNode = {
        id: concept,
        concept,
        relations: [],
        confidence: 0.5,
        sources: [experience.id],
        lastUpdated: Date.now(),
      };
      this.nodes.set(concept, node);
    }
  }

  /**
   * Calculate relevance of a node to query words
   */
  private calculateRelevance(queryWords: string[], node: SemanticNode): number {
    const conceptWords = node.concept.toLowerCase().split(/\s+/);
    let relevance = 0;

    for (const queryWord of queryWords) {
      for (const conceptWord of conceptWords) {
        if (conceptWord.includes(queryWord) || queryWord.includes(conceptWord)) {
          relevance += 0.5;
        }
        if (conceptWord === queryWord) {
          relevance += 1;
        }
      }
    }

    return Math.min(1, relevance / queryWords.length) * node.confidence;
  }

  /**
   * Get knowledge graph statistics
   */
  getStats(): {
    totalNodes: number;
    averageConfidence: number;
    totalRelations: number;
  } {
    const nodes = Array.from(this.nodes.values());
    const totalRelations = nodes.reduce((sum, node) => sum + node.relations.length, 0);
    const averageConfidence =
      nodes.length > 0 ? nodes.reduce((sum, node) => sum + node.confidence, 0) / nodes.length : 0;

    return {
      totalNodes: nodes.length,
      averageConfidence,
      totalRelations,
    };
  }
}

// ========================================================================================
// HYBRID MEMORY ARCHITECTURE
// ========================================================================================

/**
 * Hybrid memory architecture combining different storage strategies
 */
export class AgentMemory {
  private shortTerm: LRUCache<string, Experience>;
  private episodic: VectorStore;
  private semantic: KnowledgeGraph;
  private logger = Logger.namespace('AGENT_MEMORY');

  constructor(shortTermSize = 50) {
    this.shortTerm = new LRUCache(shortTermSize);
    this.episodic = new VectorStore();
    this.semantic = new KnowledgeGraph();

    this.logger.info('Agent memory initialized', {
      shortTermSize,
      components: ['short-term', 'episodic', 'semantic'],
    });
  }

  /**
   * Remember an experience across all memory systems
   */
  async remember(experience: Experience): Promise<void> {
    this.logger.debug('Remembering experience', {
      id: experience.id,
      content: experience.content.substring(0, 100),
      importance: experience.importance,
      tags: experience.tags,
    });

    // Store in short-term memory
    this.shortTerm.set(experience.id, experience);

    // Index in episodic memory
    await this.episodic.index(experience);

    // Extract semantic knowledge
    await this.semantic.extract(experience);

    this.logger.debug('Experience remembered across all systems', {
      id: experience.id,
      shortTermSize: this.shortTerm.getStats().size,
      episodicSize: this.episodic.getStats().totalVectors,
      semanticSize: this.semantic.getStats().totalNodes,
    });
  }

  /**
   * Recall memories based on context
   */
  async recall(
    context: string,
    options: {
      includeShortTerm?: boolean;
      includeEpisodic?: boolean;
      includeSemantic?: boolean;
      limit?: number;
    } = {}
  ): Promise<Memory[]> {
    const {
      includeShortTerm = true,
      includeEpisodic = true,
      includeSemantic = true,
      limit = 20,
    } = options;

    this.logger.debug('Recalling memories', {
      context: context.substring(0, 50),
      includeShortTerm,
      includeEpisodic,
      includeSemantic,
      limit,
    });

    const memories: Memory[] = [];
    const now = Date.now();

    // Recall from short-term memory
    if (includeShortTerm) {
      const recentExperiences = this.shortTerm
        .values()
        .filter((exp) => this.isRelevant(exp, context))
        .map((exp) => ({
          type: 'short-term' as const,
          content: exp,
          relevance: this.calculateRelevance(exp, context),
          confidence: 1.0,
          age: now - exp.timestamp,
          sourceId: exp.id,
          context: exp.context,
        }));

      memories.push(...recentExperiences);
    }

    // Recall from episodic memory
    if (includeEpisodic) {
      const episodicResults = await this.episodic.search(context, Math.floor(limit / 2));
      const episodicMemories = episodicResults.map((result) => ({
        type: 'episodic' as const,
        content: result.content,
        relevance: result.similarity,
        confidence: 0.8,
        age: now - (Date.now() - 3600000), // Placeholder age
        sourceId: result.id,
      }));

      memories.push(...episodicMemories);
    }

    // Recall from semantic memory
    if (includeSemantic) {
      const semanticResults = await this.semantic.query(context);
      const semanticMemories = semanticResults.map((result) => ({
        type: 'semantic' as const,
        content: result.concept,
        relevance: result.relevance,
        confidence: result.confidence,
        age: 0, // Semantic knowledge is timeless
      }));

      memories.push(...semanticMemories);
    }

    // Merge and sort memories by relevance
    const mergedMemories = this.mergeMemories(memories);
    const sortedMemories = mergedMemories.sort((a, b) => b.relevance - a.relevance).slice(0, limit);

    this.logger.debug('Memory recall completed', {
      context: context.substring(0, 50),
      totalMemories: sortedMemories.length,
      shortTermCount: sortedMemories.filter((m) => m.type === 'short-term').length,
      episodicCount: sortedMemories.filter((m) => m.type === 'episodic').length,
      semanticCount: sortedMemories.filter((m) => m.type === 'semantic').length,
    });

    return sortedMemories;
  }

  /**
   * Forget experiences (remove from short-term, mark as less important)
   */
  async forget(experienceId: string): Promise<void> {
    this.logger.debug('Forgetting experience', { experienceId });

    // Remove from short-term memory
    this.shortTerm.set(experienceId, {
      id: experienceId,
      content: '',
      timestamp: 0,
      context: {},
      importance: 0,
      tags: [],
    });
  }

  /**
   * Get memory system statistics
   */
  getStats(): {
    shortTerm: ReturnType<LRUCache<string, Experience>['getStats']>;
    episodic: ReturnType<VectorStore['getStats']>;
    semantic: ReturnType<KnowledgeGraph['getStats']>;
    totalMemories: number;
  } {
    const shortTermStats = this.shortTerm.getStats();
    const episodicStats = this.episodic.getStats();
    const semanticStats = this.semantic.getStats();

    return {
      shortTerm: shortTermStats,
      episodic: episodicStats,
      semantic: semanticStats,
      totalMemories: shortTermStats.size + episodicStats.totalVectors + semanticStats.totalNodes,
    };
  }

  /**
   * Check if an experience is relevant to the context
   */
  private isRelevant(experience: Experience, context: string): boolean {
    const contextWords = context.toLowerCase().split(/\s+/);
    const experienceWords = experience.content.toLowerCase().split(/\s+/);

    const overlap = contextWords.filter((word) => experienceWords.includes(word)).length;
    return overlap > 0 || experience.tags.some((tag) => contextWords.includes(tag.toLowerCase()));
  }

  /**
   * Calculate relevance score for an experience
   */
  private calculateRelevance(experience: Experience, context: string): number {
    const contextWords = context.toLowerCase().split(/\s+/);
    const experienceWords = experience.content.toLowerCase().split(/\s+/);

    const overlap = contextWords.filter((word) => experienceWords.includes(word)).length;
    const baseRelevance = overlap / Math.max(contextWords.length, experienceWords.length);

    // Boost relevance based on importance and recency
    const importanceBoost = experience.importance * 0.3;
    const recencyBoost =
      Math.max(0, 1 - (Date.now() - experience.timestamp) / (24 * 60 * 60 * 1000)) * 0.2;

    return Math.min(1, baseRelevance + importanceBoost + recencyBoost);
  }

  /**
   * Merge duplicate memories and combine their relevance scores
   */
  private mergeMemories(memories: Memory[]): Memory[] {
    const merged = new Map<string, Memory>();

    for (const memory of memories) {
      const key = `${memory.type}:${typeof memory.content === 'string' ? memory.content : JSON.stringify(memory.content)}`;

      const existing = merged.get(key);
      if (existing) {
        existing.relevance = Math.max(existing.relevance, memory.relevance);
        existing.confidence = Math.max(existing.confidence, memory.confidence);
      } else {
        merged.set(key, memory);
      }
    }

    return Array.from(merged.values());
  }
}

// ========================================================================================
// UTILITY FUNCTIONS
// ========================================================================================

/**
 * Create a new experience
 */
export function createExperience(
  content: string,
  options: Partial<Omit<Experience, 'id' | 'content' | 'timestamp'>> = {}
): Experience {
  return {
    id: `exp-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
    content,
    timestamp: Date.now(),
    context: options.context || {},
    importance: options.importance || 0.5,
    tags: options.tags || [],
    valence: options.valence,
    metadata: options.metadata,
  };
}

/**
 * Create a new agent memory instance
 */
export function createAgentMemory(shortTermSize = 50): AgentMemory {
  return new AgentMemory(shortTermSize);
}
