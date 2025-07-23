/**
 * @module actor-core/runtime/examples/hybrid-memory-example
 * @description Examples demonstrating hybrid memory architecture for autonomous agents
 * @author Agent A (Tech Lead) - 2025-07-17
 */

import { Logger } from '../logger.js';
import {
  createAgentMemory,
  createExperience,
  type Experience,
  type Memory,
} from '../memory/hybrid-memory.js';

// Setup logging
const log = Logger.namespace('HYBRID_MEMORY_EXAMPLE');

// ========================================================================================
// EXAMPLE DATA AND SCENARIOS
// ========================================================================================

/**
 * Sample experiences for testing the memory system
 */
const sampleExperiences: Array<Omit<Experience, 'id' | 'timestamp'>> = [
  {
    content:
      'The user asked about machine learning algorithms and seemed interested in neural networks.',
    context: { interaction: 'conversation', userId: 'user123', topic: 'ml' },
    importance: 0.8,
    tags: ['machine-learning', 'neural-networks', 'user-interest'],
    valence: 0.5,
  },
  {
    content: 'Successfully helped debug a TypeScript error related to type inference.',
    context: { interaction: 'problem-solving', language: 'typescript', success: true },
    importance: 0.7,
    tags: ['typescript', 'debugging', 'problem-solving', 'success'],
    valence: 0.8,
  },
  {
    content: 'User expressed frustration with API documentation being unclear.',
    context: { interaction: 'feedback', sentiment: 'negative', topic: 'documentation' },
    importance: 0.6,
    tags: ['documentation', 'api', 'user-frustration', 'feedback'],
    valence: -0.3,
  },
  {
    content: 'Learned that the user prefers concise explanations over detailed ones.',
    context: { interaction: 'preference', userId: 'user123', preference: 'concise' },
    importance: 0.9,
    tags: ['user-preference', 'communication-style', 'concise'],
    valence: 0.2,
  },
  {
    content:
      'Encountered a new pattern in actor-model implementation that could improve performance.',
    context: { discovery: 'pattern', domain: 'actor-model', impact: 'performance' },
    importance: 0.85,
    tags: ['actor-model', 'performance', 'pattern', 'discovery'],
    valence: 0.7,
  },
  {
    content: 'User mentioned they are working on a React project with state management challenges.',
    context: { interaction: 'context', technology: 'react', problem: 'state-management' },
    importance: 0.75,
    tags: ['react', 'state-management', 'user-project', 'context'],
    valence: 0.1,
  },
  {
    content: 'Observed that error messages in the current system are not user-friendly.',
    context: { observation: 'system-issue', category: 'usability', priority: 'medium' },
    importance: 0.65,
    tags: ['error-messages', 'usability', 'system-improvement'],
    valence: -0.2,
  },
  {
    content: 'Positive feedback received about the pipeline pattern implementation.',
    context: { feedback: 'positive', feature: 'pipeline-pattern', source: 'user' },
    importance: 0.8,
    tags: ['pipeline-pattern', 'positive-feedback', 'implementation'],
    valence: 0.9,
  },
  {
    content: 'Discovered that TypeScript 5.0 has new features that could benefit the project.',
    context: { discovery: 'technology', version: '5.0', language: 'typescript' },
    importance: 0.7,
    tags: ['typescript', 'new-features', 'project-benefit'],
    valence: 0.6,
  },
  {
    content: 'User seems to have difficulty understanding async/await patterns.',
    context: { observation: 'user-difficulty', concept: 'async-await', interaction: 'teaching' },
    importance: 0.8,
    tags: ['async-await', 'user-difficulty', 'teaching-opportunity'],
    valence: -0.1,
  },
];

// ========================================================================================
// MEMORY SYSTEM EXAMPLES
// ========================================================================================

/**
 * Example 1: Basic memory operations
 */
export async function demonstrateBasicMemoryOperations(): Promise<void> {
  log.info('🧠 Basic Memory Operations Example');

  // Create memory system
  const memory = createAgentMemory(10); // Small short-term memory for demo

  // Remember some experiences
  log.info('📝 Storing experiences in memory...');

  for (let i = 0; i < 5; i++) {
    const experienceData = sampleExperiences[i];
    const experience = createExperience(experienceData.content, experienceData);

    log.debug(`Storing experience ${i + 1}`, {
      id: experience.id,
      content: `${experience.content.substring(0, 60)}...`,
      importance: experience.importance,
      tags: experience.tags,
    });

    await memory.remember(experience);

    // Small delay to show progression
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  // Get initial memory stats
  const initialStats = memory.getStats();
  log.info('📊 Initial memory statistics', {
    shortTermSize: initialStats.shortTerm.size,
    episodicVectors: initialStats.episodic.totalVectors,
    semanticNodes: initialStats.semantic.totalNodes,
    totalMemories: initialStats.totalMemories,
  });

  // Test memory recall with different contexts
  const testQueries = [
    'machine learning and neural networks',
    'TypeScript debugging help',
    'user preferences and communication',
    'React state management',
    'performance improvements',
  ];

  for (const query of testQueries) {
    log.info(`🔍 Recalling memories for: "${query}"`);

    const memories = await memory.recall(query, { limit: 3 });

    log.info(`Found ${memories.length} relevant memories`, {
      query,
      memories: memories.map((m) => ({
        type: m.type,
        content: typeof m.content === 'string' ? `${m.content.substring(0, 50)}...` : m.content,
        relevance: Math.round(m.relevance * 100) / 100,
        confidence: Math.round(m.confidence * 100) / 100,
        age: m.age ? `${Math.round(m.age / 1000)}s` : 'timeless',
      })),
    });
  }

  log.info('✅ Basic memory operations example completed');
}

/**
 * Example 2: Memory system evolution over time
 */
export async function demonstrateMemoryEvolution(): Promise<void> {
  log.info('⏳ Memory Evolution Example');

  const memory = createAgentMemory(8); // Limited short-term memory

  // Phase 1: Initial learning
  log.info('📚 Phase 1: Initial learning period');

  const initialExperiences = sampleExperiences.slice(0, 4);
  for (const expData of initialExperiences) {
    const experience = createExperience(expData.content, expData);
    await memory.remember(experience);
  }

  const phase1Stats = memory.getStats();
  log.info('Phase 1 statistics', {
    shortTerm: phase1Stats.shortTerm.size,
    episodic: phase1Stats.episodic.totalVectors,
    semantic: phase1Stats.semantic.totalNodes,
  });

  // Phase 2: Continued learning (should start evicting from short-term)
  log.info('📖 Phase 2: Continued learning (short-term eviction)');

  const additionalExperiences = sampleExperiences.slice(4, 8);
  for (const expData of additionalExperiences) {
    const experience = createExperience(expData.content, expData);
    await memory.remember(experience);
  }

  const phase2Stats = memory.getStats();
  log.info('Phase 2 statistics', {
    shortTerm: phase2Stats.shortTerm.size,
    episodic: phase2Stats.episodic.totalVectors,
    semantic: phase2Stats.semantic.totalNodes,
  });

  // Phase 3: Memory consolidation
  log.info('🔄 Phase 3: Memory consolidation');

  const remainingExperiences = sampleExperiences.slice(8);
  for (const expData of remainingExperiences) {
    const experience = createExperience(expData.content, expData);
    await memory.remember(experience);
  }

  const phase3Stats = memory.getStats();
  log.info('Phase 3 statistics', {
    shortTerm: phase3Stats.shortTerm.size,
    episodic: phase3Stats.episodic.totalVectors,
    semantic: phase3Stats.semantic.totalNodes,
  });

  // Test how memory recall changes over time
  log.info('🔍 Testing memory recall evolution');

  const testQuery = 'user preferences and TypeScript';
  const allMemories = await memory.recall(testQuery, { limit: 5 });

  log.info('Memory recall after all phases', {
    query: testQuery,
    memoriesFound: allMemories.length,
    memoryTypes: {
      shortTerm: allMemories.filter((m) => m.type === 'short-term').length,
      episodic: allMemories.filter((m) => m.type === 'episodic').length,
      semantic: allMemories.filter((m) => m.type === 'semantic').length,
    },
    topMemories: allMemories.slice(0, 3).map((m) => ({
      type: m.type,
      relevance: Math.round(m.relevance * 100) / 100,
      confidence: Math.round(m.confidence * 100) / 100,
    })),
  });

  log.info('✅ Memory evolution example completed');
}

/**
 * Example 3: Selective memory recall
 */
export async function demonstrateSelectiveRecall(): Promise<void> {
  log.info('🎯 Selective Memory Recall Example');

  const memory = createAgentMemory(15);

  // Store all sample experiences
  log.info('📝 Storing all sample experiences...');

  for (const expData of sampleExperiences) {
    const experience = createExperience(expData.content, expData);
    await memory.remember(experience);
  }

  // Test different recall strategies
  const testQuery = 'TypeScript and React development';

  // Strategy 1: Short-term only
  log.info('🔍 Strategy 1: Short-term memory only');
  const shortTermOnly = await memory.recall(testQuery, {
    includeShortTerm: true,
    includeEpisodic: false,
    includeSemantic: false,
    limit: 10,
  });

  log.info('Short-term recall results', {
    query: testQuery,
    resultsCount: shortTermOnly.length,
    results: shortTermOnly.map((m) => ({
      type: m.type,
      relevance: Math.round(m.relevance * 100) / 100,
      age: m.age ? `${Math.round(m.age / 1000)}s` : 'N/A',
    })),
  });

  // Strategy 2: Episodic only
  log.info('🔍 Strategy 2: Episodic memory only');
  const episodicOnly = await memory.recall(testQuery, {
    includeShortTerm: false,
    includeEpisodic: true,
    includeSemantic: false,
    limit: 10,
  });

  log.info('Episodic recall results', {
    query: testQuery,
    resultsCount: episodicOnly.length,
    results: episodicOnly.map((m) => ({
      type: m.type,
      relevance: Math.round(m.relevance * 100) / 100,
      content: typeof m.content === 'string' ? `${m.content.substring(0, 40)}...` : m.content,
    })),
  });

  // Strategy 3: Semantic only
  log.info('🔍 Strategy 3: Semantic memory only');
  const semanticOnly = await memory.recall(testQuery, {
    includeShortTerm: false,
    includeEpisodic: false,
    includeSemantic: true,
    limit: 10,
  });

  log.info('Semantic recall results', {
    query: testQuery,
    resultsCount: semanticOnly.length,
    results: semanticOnly.map((m) => ({
      type: m.type,
      relevance: Math.round(m.relevance * 100) / 100,
      concept: m.content,
      confidence: Math.round(m.confidence * 100) / 100,
    })),
  });

  // Strategy 4: Combined recall (default)
  log.info('🔍 Strategy 4: Combined memory recall');
  const combinedRecall = await memory.recall(testQuery, { limit: 10 });

  log.info('Combined recall results', {
    query: testQuery,
    resultsCount: combinedRecall.length,
    typeDistribution: {
      shortTerm: combinedRecall.filter((m) => m.type === 'short-term').length,
      episodic: combinedRecall.filter((m) => m.type === 'episodic').length,
      semantic: combinedRecall.filter((m) => m.type === 'semantic').length,
    },
    topResults: combinedRecall.slice(0, 3).map((m) => ({
      type: m.type,
      relevance: Math.round(m.relevance * 100) / 100,
      confidence: Math.round(m.confidence * 100) / 100,
    })),
  });

  log.info('✅ Selective memory recall example completed');
}

/**
 * Example 4: Memory-driven decision making
 */
export async function demonstrateMemoryDrivenDecisions(): Promise<void> {
  log.info('🎲 Memory-Driven Decision Making Example');

  const memory = createAgentMemory(12);

  // Store experiences with different valence and importance
  log.info('📝 Storing experiences with varied emotional context...');

  for (const expData of sampleExperiences) {
    const experience = createExperience(expData.content, expData);
    await memory.remember(experience);

    // Add small delay to create temporal separation
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  // Simulate decision-making scenarios
  const decisionScenarios = [
    {
      context: 'User is asking about TypeScript help',
      query: 'TypeScript debugging assistance',
      decision: 'How to respond based on past interactions',
    },
    {
      context: 'User seems frustrated with documentation',
      query: 'documentation problems and user frustration',
      decision: 'How to improve communication approach',
    },
    {
      context: 'User interested in performance optimization',
      query: 'performance patterns and improvements',
      decision: 'What solutions to prioritize',
    },
    {
      context: 'User working on React state management',
      query: 'React state management challenges',
      decision: 'What level of detail to provide',
    },
  ];

  for (const scenario of decisionScenarios) {
    log.info(`🤔 Decision scenario: ${scenario.context}`);

    const relevantMemories = await memory.recall(scenario.query, { limit: 5 });

    // Analyze memories to make decision
    const analysis = analyzeMemoriesForDecision(relevantMemories);

    log.info('Decision analysis', {
      scenario: scenario.context,
      memoriesAnalyzed: relevantMemories.length,
      analysis: {
        overallSentiment: analysis.overallSentiment,
        confidenceLevel: analysis.confidenceLevel,
        recommendedApproach: analysis.recommendedApproach,
        keyInsights: analysis.keyInsights,
      },
    });

    // Show supporting memories
    log.debug('Supporting memories', {
      topMemories: relevantMemories.slice(0, 3).map((m) => ({
        type: m.type,
        content: typeof m.content === 'string' ? `${m.content.substring(0, 50)}...` : m.content,
        relevance: Math.round(m.relevance * 100) / 100,
        confidence: Math.round(m.confidence * 100) / 100,
      })),
    });
  }

  log.info('✅ Memory-driven decision making example completed');
}

/**
 * Helper function to analyze memories for decision making
 */
function analyzeMemoriesForDecision(memories: Memory[]): {
  overallSentiment: 'positive' | 'negative' | 'neutral';
  confidenceLevel: 'high' | 'medium' | 'low';
  recommendedApproach: string;
  keyInsights: string[];
} {
  if (memories.length === 0) {
    return {
      overallSentiment: 'neutral',
      confidenceLevel: 'low',
      recommendedApproach: 'Use standard approach',
      keyInsights: ['No relevant memories found'],
    };
  }

  // Calculate overall sentiment from experiences
  const sentimentScores = memories
    .map((m) => {
      if (typeof m.content === 'object' && m.content && 'valence' in m.content) {
        return (m.content as any).valence || 0;
      }
      return 0;
    })
    .filter((score) => score !== 0);

  const avgSentiment =
    sentimentScores.length > 0
      ? sentimentScores.reduce((sum, score) => sum + score, 0) / sentimentScores.length
      : 0;

  const overallSentiment =
    avgSentiment > 0.1 ? 'positive' : avgSentiment < -0.1 ? 'negative' : 'neutral';

  // Calculate confidence level
  const avgConfidence = memories.reduce((sum, m) => sum + m.confidence, 0) / memories.length;
  const confidenceLevel = avgConfidence > 0.8 ? 'high' : avgConfidence > 0.6 ? 'medium' : 'low';

  // Generate insights
  const keyInsights = [
    `Based on ${memories.length} relevant memories`,
    `Average confidence: ${Math.round(avgConfidence * 100)}%`,
    `Memory types: ${[...new Set(memories.map((m) => m.type))].join(', ')}`,
  ];

  // Recommend approach based on analysis
  let recommendedApproach = 'Use standard approach';
  if (overallSentiment === 'negative') {
    recommendedApproach = 'Use cautious, supportive approach';
  } else if (overallSentiment === 'positive') {
    recommendedApproach = 'Use confident, detailed approach';
  } else if (confidenceLevel === 'high') {
    recommendedApproach = 'Use proven strategies from past success';
  }

  return {
    overallSentiment,
    confidenceLevel,
    recommendedApproach,
    keyInsights,
  };
}

// ========================================================================================
// MAIN EXAMPLE RUNNER
// ========================================================================================

/**
 * Run all hybrid memory examples
 */
export async function runHybridMemoryExamples(): Promise<void> {
  try {
    log.info('🚀 Starting Hybrid Memory Examples');

    await demonstrateBasicMemoryOperations();
    await new Promise((resolve) => setTimeout(resolve, 1000));

    await demonstrateMemoryEvolution();
    await new Promise((resolve) => setTimeout(resolve, 1000));

    await demonstrateSelectiveRecall();
    await new Promise((resolve) => setTimeout(resolve, 1000));

    await demonstrateMemoryDrivenDecisions();

    log.info('✅ All hybrid memory examples completed successfully');
  } catch (error) {
    log.error('❌ Hybrid memory examples failed:', error);
    throw error;
  }
}

// Export for use in tests or demos
export { runHybridMemoryExamples as default };

// Run the examples if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runHybridMemoryExamples().catch(console.error);
}
