/**
 * @module actor-core/runtime/examples/pipeline-example
 * @description Examples demonstrating pipeline pattern for AI agent chains
 * @author Agent A (Tech Lead) - 2025-07-17
 */

import { assign, setup } from 'xstate';
import { createActorRef } from '../create-actor-ref.js';
import { Logger } from '../logger.js';
import {
  type PipelineStage,
  branch,
  compose,
  createActorStage,
  createPipeline,
  parallel,
  retry,
} from '../patterns/pipeline.js';
import type { BaseEventObject } from '../types.js';

// Setup logging
const log = Logger.namespace('PIPELINE_EXAMPLE');

// ========================================================================================
// EXAMPLE DATA TYPES
// ========================================================================================

interface TextInput {
  text: string;
  language?: string;
  metadata?: Record<string, unknown>;
}

interface AnalysisResult {
  sentiment: 'positive' | 'negative' | 'neutral';
  confidence: number;
  keywords: string[];
  entities: Array<{ text: string; type: string; confidence: number }>;
}

interface SummaryResult {
  summary: string;
  keyPoints: string[];
  wordCount: number;
  originalLength: number;
}

interface TranslationResult {
  translatedText: string;
  sourceLanguage: string;
  targetLanguage: string;
  confidence: number;
}

interface ProcessingResult {
  originalText: string;
  analysis: AnalysisResult;
  summary: SummaryResult;
  translation?: TranslationResult;
  processingTime: number;
}

// ========================================================================================
// EXAMPLE ACTOR MACHINES
// ========================================================================================

/**
 * Text analyzer actor
 */
const analyzerMachine = setup({
  types: {
    context: {} as {
      lastAnalysis: AnalysisResult | null;
      analysisCount: number;
    },
    events: {} as { type: 'ANALYZE'; text: string } | { type: 'GET_STATS' } | { type: 'RESET' },
  },
  actions: {
    analyze: assign({
      lastAnalysis: ({ event }) => {
        if (event.type === 'ANALYZE') {
          // Simulate text analysis
          const text = event.text.toLowerCase();
          const positiveWords = ['good', 'great', 'excellent', 'amazing', 'wonderful'];
          const negativeWords = ['bad', 'terrible', 'awful', 'horrible', 'disappointing'];

          const positiveScore = positiveWords.reduce(
            (score, word) => score + (text.includes(word) ? 1 : 0),
            0
          );
          const negativeScore = negativeWords.reduce(
            (score, word) => score + (text.includes(word) ? 1 : 0),
            0
          );

          const sentiment: 'positive' | 'negative' | 'neutral' =
            positiveScore > negativeScore
              ? 'positive'
              : negativeScore > positiveScore
                ? 'negative'
                : 'neutral';

          const confidence = Math.max(
            0.6,
            Math.min(0.95, (Math.abs(positiveScore - negativeScore) + 1) / 10)
          );

          return {
            sentiment,
            confidence: Math.round(confidence * 100) / 100,
            keywords: text
              .split(' ')
              .filter((word) => word.length > 4)
              .slice(0, 5),
            entities: [{ text: 'example', type: 'misc', confidence: 0.8 }],
          };
        }
        return null;
      },
      analysisCount: ({ context }) => context.analysisCount + 1,
    }),

    reset: assign({
      lastAnalysis: () => null,
      analysisCount: () => 0,
    }),
  },
}).createMachine({
  id: 'analyzer',
  initial: 'idle',
  context: {
    lastAnalysis: null,
    analysisCount: 0,
  },
  states: {
    idle: {
      on: {
        ANALYZE: {
          target: 'analyzing',
          actions: 'analyze',
        },
        GET_STATS: {
          target: 'idle',
        },
        RESET: {
          actions: 'reset',
        },
      },
    },
    analyzing: {
      after: {
        100: 'idle', // Simulate processing delay
      },
    },
  },
});

/**
 * Text summarizer actor
 */
const summarizerMachine = setup({
  types: {
    context: {} as {
      lastSummary: SummaryResult | null;
      summaryCount: number;
    },
    events: {} as { type: 'SUMMARIZE'; text: string } | { type: 'GET_STATS' } | { type: 'RESET' },
  },
  actions: {
    summarize: assign({
      lastSummary: ({ event }) => {
        if (event.type === 'SUMMARIZE') {
          const text = event.text;
          const sentences = text.split('.').filter((s) => s.trim().length > 0);
          const wordCount = text.split(' ').length;

          // Simple summarization: take first and last sentence
          const summary =
            sentences.length > 2
              ? `${sentences[0].trim()}. ${sentences[sentences.length - 1].trim()}.`
              : text;

          return {
            summary,
            keyPoints: sentences
              .slice(0, 3)
              .map((s) => s.trim())
              .filter((s) => s.length > 0),
            wordCount: summary.split(' ').length,
            originalLength: wordCount,
          };
        }
        return null;
      },
      summaryCount: ({ context }) => context.summaryCount + 1,
    }),

    reset: assign({
      lastSummary: () => null,
      summaryCount: () => 0,
    }),
  },
}).createMachine({
  id: 'summarizer',
  initial: 'idle',
  context: {
    lastSummary: null,
    summaryCount: 0,
  },
  states: {
    idle: {
      on: {
        SUMMARIZE: {
          target: 'summarizing',
          actions: 'summarize',
        },
        GET_STATS: {
          target: 'idle',
        },
        RESET: {
          actions: 'reset',
        },
      },
    },
    summarizing: {
      after: {
        200: 'idle', // Simulate processing delay
      },
    },
  },
});

/**
 * Text translator actor
 */
const translatorMachine = setup({
  types: {
    context: {} as {
      lastTranslation: TranslationResult | null;
      translationCount: number;
    },
    events: {} as
      | { type: 'TRANSLATE'; text: string; targetLanguage: string }
      | { type: 'GET_STATS' }
      | { type: 'RESET' },
  },
  actions: {
    translate: assign({
      lastTranslation: ({ event }) => {
        if (event.type === 'TRANSLATE') {
          // Simulate translation
          const translations: Record<string, string> = {
            es: 'Este es un texto traducido al español.',
            fr: 'Ceci est un texte traduit en français.',
            de: 'Dies ist ein ins Deutsche übersetzter Text.',
            it: 'Questo è un testo tradotto in italiano.',
          };

          const translatedText =
            translations[event.targetLanguage] ||
            `[Translated to ${event.targetLanguage}] ${event.text}`;

          return {
            translatedText,
            sourceLanguage: 'en',
            targetLanguage: event.targetLanguage,
            confidence: 0.92,
          };
        }
        return null;
      },
      translationCount: ({ context }) => context.translationCount + 1,
    }),

    reset: assign({
      lastTranslation: () => null,
      translationCount: () => 0,
    }),
  },
}).createMachine({
  id: 'translator',
  initial: 'idle',
  context: {
    lastTranslation: null,
    translationCount: 0,
  },
  states: {
    idle: {
      on: {
        TRANSLATE: {
          target: 'translating',
          actions: 'translate',
        },
        GET_STATS: {
          target: 'idle',
        },
        RESET: {
          actions: 'reset',
        },
      },
    },
    translating: {
      after: {
        150: 'idle', // Simulate processing delay
      },
    },
  },
});

// ========================================================================================
// PIPELINE EXAMPLES
// ========================================================================================

/**
 * Example 1: Simple linear pipeline
 */
export async function demonstrateSimpleLinearPipeline(): Promise<void> {
  log.info('📝 Simple Linear Pipeline Example');

  // Create simple processing stages
  const validateInput: PipelineStage<string, TextInput> = async (input: string) => {
    if (!input || input.trim().length === 0) {
      throw new Error('Input text cannot be empty');
    }
    return { text: input.trim() };
  };

  const addMetadata: PipelineStage<TextInput, TextInput> = async (input: TextInput) => {
    return {
      ...input,
      metadata: {
        timestamp: new Date().toISOString(),
        wordCount: input.text.split(' ').length,
        characterCount: input.text.length,
      },
    };
  };

  const formatOutput: PipelineStage<TextInput, string> = async (input: TextInput) => {
    return `Processed: "${input.text}" (${input.metadata?.wordCount} words)`;
  };

  // Create pipeline
  const pipeline = createPipeline({
    name: 'simple-text-processor',
    timeout: 5000,
  })
    .stage({
      name: 'validate-input',
      stage: validateInput,
      timeout: 1000,
    })
    .stage({
      name: 'add-metadata',
      stage: addMetadata,
      timeout: 1000,
    })
    .stage({
      name: 'format-output',
      stage: formatOutput,
      timeout: 1000,
    });

  // Execute pipeline
  const testInput = 'Hello world, this is a test of the pipeline system!';
  log.info('🚀 Executing simple pipeline', { input: testInput });

  const result = await pipeline.execute(testInput);

  if (result.success) {
    log.info('✅ Simple pipeline completed successfully', {
      result: result.result,
      executionTime: result.stats.executionTime,
      stagesExecuted: result.stats.stagesExecuted,
    });
  } else {
    log.error('❌ Simple pipeline failed', {
      error: result.error?.message,
      stagesExecuted: result.stats.stagesExecuted,
    });
  }

  log.info('✅ Simple linear pipeline example completed');
}

/**
 * Example 2: Actor-based pipeline
 */
export async function demonstrateActorBasedPipeline(): Promise<void> {
  log.info('🎭 Actor-Based Pipeline Example');

  // Create actor instances
  const analyzerActor = createActorRef(analyzerMachine, { id: 'analyzer' });
  const summarizerActor = createActorRef(summarizerMachine, { id: 'summarizer' });
  const translatorActor = createActorRef(translatorMachine, { id: 'translator' });

  // Start actors
  analyzerActor.start();
  summarizerActor.start();
  translatorActor.start();

  // Create actor stages
  const analyzeStage = createActorStage({
    actor: analyzerActor,
    eventType: 'ANALYZE',
    mapInput: (input: TextInput) => ({ type: 'ANALYZE', text: input.text }) as BaseEventObject,
    mapOutput: (response: unknown) => response as AnalysisResult,
    timeout: 3000,
  });

  const summarizeStage = createActorStage({
    actor: summarizerActor,
    eventType: 'SUMMARIZE',
    mapInput: (input: { text: string; analysis: AnalysisResult }) =>
      ({ type: 'SUMMARIZE', text: input.text }) as BaseEventObject,
    mapOutput: (response: unknown) => response as SummaryResult,
    timeout: 3000,
  });

  const translateStage = createActorStage({
    actor: translatorActor,
    eventType: 'TRANSLATE',
    mapInput: (input: { summary: SummaryResult; targetLanguage: string }) =>
      ({
        type: 'TRANSLATE',
        text: input.summary.summary,
        targetLanguage: input.targetLanguage,
      }) as BaseEventObject,
    mapOutput: (response: unknown) => response as TranslationResult,
    timeout: 3000,
  });

  // Create pipeline with actor stages
  const pipeline = createPipeline({
    name: 'ai-text-processor',
    timeout: 15000,
    errorStrategy: 'continue',
  })
    .stage({
      name: 'analyze-text',
      stage: analyzeStage,
      retry: { attempts: 2, delay: 500 },
    })
    .stage({
      name: 'combine-analysis',
      stage: async (analysis: AnalysisResult) => ({
        text: 'This is a sample text for processing through our AI pipeline.',
        analysis,
      }),
    })
    .stage({
      name: 'summarize-text',
      stage: summarizeStage,
      retry: { attempts: 2, delay: 500 },
    })
    .stage({
      name: 'prepare-translation',
      stage: async (summary: SummaryResult) => ({
        summary,
        targetLanguage: 'es',
      }),
    })
    .stage({
      name: 'translate-summary',
      stage: translateStage,
      retry: { attempts: 2, delay: 500 },
    })
    .stage({
      name: 'create-final-result',
      stage: async (translation: TranslationResult) => ({
        originalText: 'This is a sample text for processing through our AI pipeline.',
        analysis: {
          sentiment: 'positive' as const,
          confidence: 0.85,
          keywords: ['sample', 'pipeline', 'processing'],
          entities: [{ text: 'AI', type: 'technology', confidence: 0.9 }],
        },
        summary: {
          summary: 'Sample text processing pipeline',
          keyPoints: ['AI processing', 'pipeline execution'],
          wordCount: 4,
          originalLength: 10,
        },
        translation,
        processingTime: 0,
      }),
    });

  // Execute pipeline
  const testInput: TextInput = {
    text: 'This is a sample text for processing through our AI pipeline.',
    language: 'en',
  };

  log.info('🚀 Executing actor-based pipeline', { input: testInput });

  const result = await pipeline.execute(testInput);

  if (result.success) {
    log.info('✅ Actor-based pipeline completed successfully', {
      result: result.result,
      executionTime: result.stats.executionTime,
      stageTimings: result.stats.stageTimings,
    });
  } else {
    log.error('❌ Actor-based pipeline failed', {
      error: result.error?.message,
      stageTimings: result.stats.stageTimings,
    });
  }

  // Cleanup
  await analyzerActor.stop();
  await summarizerActor.stop();
  await translatorActor.stop();

  log.info('✅ Actor-based pipeline example completed');
}

/**
 * Example 3: Functional composition patterns
 */
export async function demonstrateFunctionalComposition(): Promise<void> {
  log.info('🔧 Functional Composition Example');

  // Create reusable stages
  const normalize: PipelineStage<string, string> = async (input: string) => {
    return input.trim().toLowerCase();
  };

  const wordCount: PipelineStage<string, { text: string; count: number }> = async (
    input: string
  ) => {
    return {
      text: input,
      count: input.split(' ').length,
    };
  };

  const addTimestamp: PipelineStage<
    { text: string; count: number },
    { text: string; count: number; timestamp: string }
  > = async (input) => {
    return {
      ...input,
      timestamp: new Date().toISOString(),
    };
  };

  const formatResult: PipelineStage<
    { text: string; count: number; timestamp: string },
    string
  > = async (input) => {
    return `"${input.text}" (${input.count} words) processed at ${input.timestamp}`;
  };

  // Method 1: Using compose function
  log.info('🎯 Method 1: Using compose function');
  const composedPipeline = compose(normalize, wordCount, addTimestamp, formatResult);

  const composeResult = await composedPipeline.execute('  Hello World From Composed Pipeline  ');
  log.info('Composed pipeline result:', { result: composeResult.result });

  // Method 2: Using branch for conditional logic
  log.info('🎯 Method 2: Using branch for conditional logic');
  const conditionalStage = branch(
    (input: string) => input.length > 20,
    async (input: string) => `Long text: ${input}`,
    async (input: string) => `Short text: ${input}`
  );

  const branchPipeline = createPipeline({ name: 'conditional-pipeline' })
    .stage({
      name: 'normalize',
      stage: normalize,
    })
    .stage({
      name: 'conditional-format',
      stage: conditionalStage,
    });

  const shortResult = await branchPipeline.execute('Short');
  const longResult = await branchPipeline.execute(
    'This is a much longer text that should trigger the long branch'
  );

  log.info('Branch results:', {
    short: shortResult.result,
    long: longResult.result,
  });

  // Method 3: Using parallel processing
  log.info('🎯 Method 3: Using parallel processing');
  const parallelStage: PipelineStage<string[], string[]> = async (inputs: string[]) => {
    return parallel(inputs, normalize);
  };

  const parallelPipeline = createPipeline({ name: 'parallel-pipeline' }).stage({
    name: 'parallel-normalize',
    stage: parallelStage,
  });

  const parallelResult = await parallelPipeline.execute(['  Hello  ', '  WORLD  ', '  Pipeline  ']);
  log.info('Parallel result:', { result: parallelResult.result });

  // Method 4: Using retry with error handling
  log.info('🎯 Method 4: Using retry with error handling');
  let attemptCount = 0;
  const flakyStage = retry(
    async (input: string) => {
      attemptCount++;
      if (attemptCount < 3) {
        throw new Error(`Attempt ${attemptCount} failed`);
      }
      return `Success on attempt ${attemptCount}: ${input}`;
    },
    3,
    100
  );

  const retryPipeline = createPipeline({ name: 'retry-pipeline' }).stage({
    name: 'flaky-operation',
    stage: flakyStage,
  });

  const retryResult = await retryPipeline.execute('Test retry');
  log.info('Retry result:', { result: retryResult.result });

  log.info('✅ Functional composition example completed');
}

/**
 * Example 4: Complex multi-stage AI workflow
 */
export async function demonstrateComplexAIWorkflow(): Promise<void> {
  log.info('🧠 Complex AI Workflow Example');

  // Create a complex pipeline that simulates a full AI processing workflow
  const aiWorkflow = createPipeline({
    name: 'ai-content-processor',
    timeout: 30000,
    errorStrategy: 'continue',
    onError: async (error, context) => {
      log.warn('Pipeline error handled', {
        error: error.message,
        stage: context.stageIndex,
        executionId: context.executionId,
      });
    },
  })
    .stage({
      name: 'input-validation',
      stage: async (input: string) => {
        if (!input || input.trim().length < 10) {
          throw new Error('Input must be at least 10 characters long');
        }
        return { text: input.trim(), language: 'en' };
      },
      timeout: 2000,
    })
    .stage({
      name: 'preprocessing',
      stage: async (input: { text: string; language: string }) => {
        // Simulate preprocessing
        return {
          ...input,
          preprocessed: true,
          tokens: input.text.split(' ').length,
          timestamp: Date.now(),
        };
      },
      timeout: 3000,
    })
    .stage({
      name: 'content-analysis',
      stage: async (input: {
        text: string;
        language: string;
        preprocessed: boolean;
        tokens: number;
        timestamp: number;
      }) => {
        // Simulate AI analysis
        await new Promise((resolve) => setTimeout(resolve, 500));

        return {
          ...input,
          analysis: {
            sentiment: 'positive' as const,
            topics: ['technology', 'ai', 'pipeline'],
            complexity: input.tokens > 50 ? 'high' : 'medium',
            readability: 0.7,
          },
        };
      },
      timeout: 5000,
      retry: { attempts: 2, delay: 1000 },
    })
    .stage({
      name: 'content-enhancement',
      stage: async (input: any) => {
        // Simulate content enhancement
        return {
          ...input,
          enhanced: {
            improvedText: `Enhanced: ${input.text}`,
            suggestions: ['Add more examples', 'Improve clarity'],
            confidence: 0.85,
          },
        };
      },
      timeout: 4000,
    })
    .stage({
      name: 'output-formatting',
      stage: async (input: any) => {
        const processingTime = Date.now() - input.timestamp;

        return {
          originalText: input.text,
          processedText: input.enhanced.improvedText,
          analysis: input.analysis,
          suggestions: input.enhanced.suggestions,
          metadata: {
            processingTime,
            tokens: input.tokens,
            language: input.language,
            confidence: input.enhanced.confidence,
          },
        };
      },
      timeout: 2000,
    });

  // Execute the complex workflow
  const complexInput =
    'This is a comprehensive test of our AI pipeline system that should trigger all stages including analysis, enhancement, and formatting.';

  log.info('🚀 Executing complex AI workflow', {
    input: complexInput.substring(0, 50) + '...',
    length: complexInput.length,
  });

  const result = await aiWorkflow.execute(complexInput);

  if (result.success) {
    log.info('✅ Complex AI workflow completed successfully', {
      processingTime: result.stats.executionTime,
      stagesExecuted: result.stats.stagesExecuted,
      result: {
        originalLength: complexInput.length,
        processedLength: (result.result as any).processedText?.length,
        analysis: (result.result as any).analysis,
        suggestions: (result.result as any).suggestions,
        metadata: (result.result as any).metadata,
      },
    });

    // Show detailed stage timings
    log.info('📊 Stage execution breakdown', {
      stageTimings: result.stats.stageTimings,
    });
  } else {
    log.error('❌ Complex AI workflow failed', {
      error: result.error?.message,
      stagesExecuted: result.stats.stagesExecuted,
      failedStages: result.stats.stageTimings.filter((s) => !s.success),
    });
  }

  log.info('✅ Complex AI workflow example completed');
}

// ========================================================================================
// MAIN EXAMPLE RUNNER
// ========================================================================================

/**
 * Run all pipeline examples
 */
export async function runPipelineExamples(): Promise<void> {
  try {
    log.info('🚀 Starting Pipeline Examples');

    await demonstrateSimpleLinearPipeline();
    await new Promise((resolve) => setTimeout(resolve, 1000));

    await demonstrateActorBasedPipeline();
    await new Promise((resolve) => setTimeout(resolve, 1000));

    await demonstrateFunctionalComposition();
    await new Promise((resolve) => setTimeout(resolve, 1000));

    await demonstrateComplexAIWorkflow();

    log.info('✅ All pipeline examples completed successfully');
  } catch (error) {
    log.error('❌ Pipeline examples failed:', error);
    throw error;
  }
}

// Export for use in tests or demos
export { runPipelineExamples as default };

// Run the examples if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runPipelineExamples().catch(console.error);
}
