// @vitest-environment node
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { z } from 'zod';
import { type Assessment, checkAssessment, Packet, recordsOf } from './evidence.js';
import { createDataset } from './fixtures.js';
import { createInvestigator } from './investigation.js';
import { assessEvidence } from './policy.js';

const weatherFinding: Assessment = {
  status: 'supported',
  findings: [
    {
      kind: 'weather-association',
      explanation: 'Measured rainfall coincides with the spike.',
      evidence: ['read_weather'],
    },
  ],
  limitations: ['Coincidence is not causation.'],
  nextQuestion: 'What else changed?',
  causation: 'not-established',
};

it.each([
  { prior: 50, day: 2, reference: 2, qualifies: false },
  { prior: 2, day: 6, reference: 2, qualifies: false },
  { prior: 2, day: 6.1, reference: 2, qualifies: true },
  { prior: 0, day: 0, reference: 0, qualifies: false },
  { prior: 0, day: 1, reference: 0, qualifies: true },
])(
  'policy and validator agree on $day mm vs $reference mm (prior $prior mm)',
  ({ prior, day, reference, qualifies }) => {
    const d = createDataset('alert-normal');
    const observations = [d.read_sales, d.read_promotions, d.read_weather];
    for (const r of recordsOf(observations, 'read_weather')) {
      r.precipitationMm = r.date === d.read_sales.scope.endDate ? day : prior;
      r.referenceDailyPrecipitationMm = reference;
    }
    expect(
      assessEvidence(observations).findings.some((f) => f.kind === 'weather-association')
    ).toBe(qualifies);
    expect(checkAssessment(weatherFinding, observations) === undefined).toBe(qualifies);
  }
);

it('requires a weather citation and available weather data, not campaign targeting', () => {
  const d = createDataset('alert-wet');
  const other = [d.read_sales, d.read_promotions];
  const campaignOnly = structuredClone(weatherFinding);
  campaignOnly.findings[0].evidence = ['read_promotions'];
  expect(checkAssessment(campaignOnly, [...other, d.read_weather])).toBeDefined();
  expect(checkAssessment(weatherFinding, other)).toBeDefined();
  expect(
    checkAssessment(weatherFinding, [...other, { ...d.read_weather, records: [] }])
  ).toBeDefined();
  expect(
    checkAssessment(weatherFinding, [
      ...other,
      { ...d.read_weather, availability: 'unavailable', records: [], reason: 'Missing' },
    ])
  ).toBeDefined();
});

// Replay the actual returned JSON and packets, not regenerated fixtures or a new model answer.
const archive = new URL('./evals/20261125T191919Z-synthesis-live.json.gz', import.meta.url);
const { runs } = z
  .object({
    runs: z
      .array(
        z.object({
          trial: z.number(),
          caseId: z.enum(['alert-normal', 'alert-wet']),
          synthesisPrompt: z.enum(['rule-only', 'one-shot']),
          status: z.literal('accepted'),
          observations: z.array(Packet).length(3),
          trace: z.object({
            events: z.array(z.object({ type: z.string(), payload: z.unknown() })),
          }),
        })
      )
      .length(8),
  })
  .parse(JSON.parse(gunzipSync(readFileSync(archive)).toString('utf8')));

it.each(runs)('replay trial $trial / $caseId / $synthesisPrompt', async (row) => {
  const completed = row.trace.events.find((e) => e.type === 'run.completed');
  const { output } = z
    .object({ output: z.object({ status: z.literal('captured'), value: z.string() }) })
    .parse(completed?.payload);
  const run = createInvestigator({
    data: async (source) => row.observations.find((o) => o.source === source),
    provider: () => ({
      ok: true,
      value: { message: { role: 'assistant', content: output.value } },
    }),
  }).start(row.observations[0].scope, {
    strategy: 'fixed',
    maxReads: 3,
    synthesisPrompt: row.synthesisPrompt,
  });
  if (row.caseId === 'alert-normal') {
    await expect(run.result).rejects.toMatchObject({ code: 'taskMismatch' });
  } else {
    expect((await run.result).assessment).toEqual(JSON.parse(output.value));
  }
  expect(run.readObservations()).toEqual(row.observations);
});
