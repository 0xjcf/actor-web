import { DefinitionRegistry } from './definitions.js';
import { allocateDemoTeams, publishDemoDefinitions, runDemoTeams } from './scenario.js';
import { describeFact } from './stages.js';
import { startTeams } from './teams.js';

const registry = new DefinitionRegistry();
const definitions = publishDemoDefinitions(registry);
console.log('Publish: reviewer@1 and reviewer@2 are available.');

const app = await startTeams({ registry });
try {
  const teams = await allocateDemoTeams(app, definitions);
  console.log('Allocate: both teams are idle and the reviewer is now retired.');
  for (const {
    assignment: { task, team },
  } of teams) {
    console.log(`  ${task.id}@${task.revision} pins ${team.review.id}@${team.review.revision}.`);
  }

  console.log('Run: dispatching both teams.');
  const results = await runDemoTeams(app, teams, process.argv.includes('--fail-checkout'));
  for (const [index, result] of results.entries()) {
    if (result.status === 'rejected') throw result.reason;
    const { task } = teams[index].assignment;
    if (!result.value.ok) {
      console.log(`${task.id}@${task.revision} stopped: ${result.value.reason}`);
      continue;
    }
    const report = result.value.value;
    console.log(`${report.taskId}@${report.taskRevision} completed:`);
    for (const { definition, fact } of report.stages) {
      console.log(`  ${definition.id}@${definition.revision}: ${describeFact(fact)}`);
    }
  }
} finally {
  await app.stop();
}
