import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPlannerReadSample } from './dist/planner-read.js';

// Resolve the public self-export from its own workspace; the sibling is optional
// for actor-web's ordinary builds and tests.
const plannerEntry = import.meta.resolve(
  '@agent-starter/workflows/planner',
  new URL('../../../agent-starter/workflows/package.json', import.meta.url)
);
const { plannerReadTools } = await import(plannerEntry);
const name = 'read_plan_file';
const assignment = { path: 'plans/current.txt', source: 'Status: ready.\nOwner: Planner.' };
const input = { root: 'workspace', path: assignment.path, startLine: 1, lineCount: 1 };
const reply = (content, toolCalls) => ({
  ok: true,
  value: { message: { role: 'assistant', content, ...(toolCalls && { toolCalls }) } },
});
const read = (args) => reply('', [{ id: 'read-1', name, input: args }]);
const run = (provider) =>
  createPlannerReadSample(plannerReadTools, provider).run({
    ...assignment,
    signal: new AbortController().signal,
  });

test('the provider sees the example, but the answer comes from the granted read', async (t) => {
  const requests = [];
  const answer = await run((request) => {
    requests.push(request);
    const last = request.messages.at(-1);
    if (last.role === 'user') return read(input);
    assert.equal(last.role, 'tool');
    return reply(JSON.parse(last.content).output.text);
  });
  assert.equal(requests.length, 2);
  const [first, second] = requests;
  const declared = plannerReadTools.find((tool) => tool.name === name);
  assert.deepEqual(first.tools, [name]);
  assert.equal(first.toolDefinitions.length, 1);
  const [advertised] = first.toolDefinitions;
  assert.equal(advertised.name, name);
  assert.deepEqual(advertised.inputSchema, declared.parameters);
  const [description, label, pair] = advertised.description.split('\n');
  assert.equal(description, declared.description);
  assert.match(label, /not observations from this task/);
  const example = JSON.parse(pair);
  const illustration = { root: 'workspace', path: 'examples/plan.txt', startLine: 1 };
  assert.deepEqual(example, {
    input: { ...illustration, lineCount: 1 },
    result: { ...illustration, text: 'Status: draft.' },
  });
  assert.deepEqual(first.messages, [
    { role: 'user', content: JSON.stringify({ path: assignment.path }) },
  ]);
  assert.doesNotMatch(
    JSON.stringify([first.system, second.messages]),
    /Status: draft|examples\/plan\.txt/
  );
  const observed = second.messages.at(-1);
  assert.equal(observed.toolCallId, 'read-1');
  assert.equal(observed.toolName, name);
  assert.deepEqual(JSON.parse(observed.content), {
    ok: true,
    output: { root: 'workspace', path: assignment.path, startLine: 1, text: 'Status: ready.' },
  });
  assert.equal(answer, 'Status: ready.');
  t.diagnostic(`Illustrative result: ${example.result.text} Observed result: ${answer}`);
});

test('the illustrative file is not a grant', async () => {
  await assert.rejects(
    run(() => read({ ...input, path: 'examples/plan.txt' })),
    { code: 'READ_DENIED' }
  );
});

test('quoting the illustrative result cannot pass output validation', async () => {
  await assert.rejects(
    run(() => reply('Status: draft.')),
    /does not match the assigned line/
  );
});
