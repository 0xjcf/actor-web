import { DefinitionRegistry, type Role, roles, type Task } from './definitions.js';
import {
  allocateDemoTeams,
  checkout,
  profile,
  publishDemoDefinitions,
  runDemoTeams,
} from './scenario.js';
import { describeFact } from './stages.js';
import { type StageProgress, startTeams } from './teams.js';

function required<T extends Element>(selector: string, root: ParentNode = document): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing dashboard element: ${selector}`);
  return element;
}

const teamGrid = required<HTMLElement>('#team-grid');
const publishButton = required<HTMLButtonElement>('#publish-definitions');
const allocateButton = required<HTMLButtonElement>('#allocate-teams');
const runButton = required<HTMLButtonElement>('#run-demo');
const resetButton = required<HTMLButtonElement>('#reset-demo');
const failureOption = required<HTMLInputElement>('#fail-checkout');
const runStatus = required<HTMLElement>('#demo-status');
const registryStatus = required<HTMLElement>('#registry-status');
const definitionList = required<HTMLUListElement>('#definition-list');
const teamTemplate = required<HTMLTemplateElement>('#team-lane');
const stageTemplate = required<HTMLTemplateElement>('#stage-row');
const roleLabels: Record<Role, string> = {
  plan: 'Plan',
  build: 'Build',
  test: 'Test',
  review: 'Review',
  document: 'Document',
};
const stateLabels = {
  pending: 'Not started',
  assigned: 'Assigned · idle',
  running: 'Running',
  completed: 'Complete',
  refused: 'Stopped',
  skipped: 'Skipped',
  idle: 'Not assigned',
};
type State = keyof typeof stateLabels;

function makeLane(task: Task, title: string) {
  const fragment = teamTemplate.content.cloneNode(true) as DocumentFragment;
  const lane = required<HTMLElement>('.team-lane', fragment);
  lane.dataset.task = task.id;
  required('h2', lane).textContent = title;
  required('.task-version', lane).textContent = `${task.id}@${task.revision}`;
  required('.task-request', lane).textContent = `${task.request} Target: “${task.expectedLabel}”`;
  const state = required<HTMLElement>('.team-state', lane);
  const address = required<HTMLElement>('.team-address', lane);
  const list = required('.stage-list', lane);
  const stages = new Map(
    roles.map((role) => {
      const rowFragment = stageTemplate.content.cloneNode(true) as DocumentFragment;
      const row = required<HTMLElement>('.stage-row', rowFragment);
      row.dataset.role = role;
      required('strong', row).textContent = roleLabels[role];
      list.append(row);
      return [role, row] as const;
    })
  );
  teamGrid.append(lane);
  return { state, address, stages };
}

const lanes = new Map<string, ReturnType<typeof makeLane>>([
  [checkout.id, makeLane(checkout, 'Checkout')],
  [profile.id, makeLane(profile, 'Profile')],
]);

function setLane(lane: ReturnType<typeof makeLane>, state: State) {
  lane.state.dataset.state = state;
  lane.state.textContent = stateLabels[state];
}

function setStage(row: HTMLElement, state: State, detail = '') {
  row.dataset.state = state;
  required('.stage-state', row).textContent = state === 'refused' ? 'Failed' : stateLabels[state];
  const output = required<HTMLElement>('.stage-output', row);
  output.hidden = !detail;
  output.textContent = detail;
}

function resetLanes() {
  for (const lane of lanes.values()) {
    setLane(lane, 'idle');
    lane.address.hidden = true;
    lane.address.textContent = '';
    for (const row of lane.stages.values()) {
      setStage(row, 'pending');
      required('.stage-definition', row).textContent = 'No pinned definition';
      for (const selector of ['.stage-session', '.stage-grants']) {
        const detail = required<HTMLElement>(selector, row);
        detail.hidden = true;
        detail.textContent = '';
      }
    }
  }
}

type DemoState =
  | { phase: 'empty' | 'finished' }
  | { phase: 'published'; rosters: ReturnType<typeof publishDemoDefinitions> }
  | {
      phase: 'allocated';
      app: Awaited<ReturnType<typeof startTeams>>;
      teams: Awaited<ReturnType<typeof allocateDemoTeams>>;
    };
let state: DemoState = { phase: 'empty' };
let registry = new DefinitionRegistry();
let busy = false;
const definitionRows = new Map<string, HTMLElement>();
const active = new Set<string>();
let overlapped = false;

function showDefinitions() {
  for (const { definition, retired } of registry.list()) {
    const version = `${definition.id}@${definition.revision}`;
    const existing = definitionRows.get(version);
    const label = `${version} · ${retired ? 'retired' : 'published'}`;
    if (existing) {
      existing.textContent = label;
      continue;
    }
    const item = document.createElement('li');
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = label;
    details.append(summary);
    const mode = definition.role === 'review' ? 'Scripted advisory fixture' : 'Deterministic code';
    for (const text of [
      `${roleLabels[definition.role]} · ${mode}`,
      definition.instruction,
      `Evidence grants: ${definition.evidenceGrants.join(', ')}`,
    ]) {
      const paragraph = document.createElement('p');
      paragraph.textContent = text;
      details.append(paragraph);
    }
    item.append(details);
    definitionList.append(item);
    definitionRows.set(version, summary);
  }
}

function syncControls() {
  publishButton.disabled = busy || state.phase !== 'empty';
  allocateButton.disabled = busy || state.phase !== 'published';
  runButton.disabled = busy || state.phase !== 'allocated';
  resetButton.disabled = busy || state.phase === 'empty';
  failureOption.disabled = busy || state.phase !== 'allocated';
}

async function handle(action: () => void | Promise<void>) {
  if (busy) return;
  busy = true;
  syncControls();
  try {
    await action();
  } catch (error) {
    state = { phase: 'finished' };
    runStatus.textContent = `Demo failed: ${String(error)}. Reset to start a new demo.`;
  } finally {
    busy = false;
    syncControls();
  }
}

function publish() {
  if (state.phase !== 'empty') return;
  state = { phase: 'published', rosters: publishDemoDefinitions(registry) };
  showDefinitions();
  registryStatus.textContent =
    'Both reviewer revisions are available. Publishing starts no actors.';
  runStatus.textContent = 'Definitions published. Inspect them, then allocate idle teams.';
}

async function allocate() {
  if (state.phase !== 'published') return;
  const { rosters } = state;
  const currentRegistry = registry;
  const app = await startTeams({
    registry,
    // Presentation pacing only; every stage still runs in its own actor.
    paceStage: (_, task) =>
      new Promise((resolve) => setTimeout(resolve, task.taskId === checkout.id ? 330 : 470)),
    observeStage: (event) => {
      if (registry === currentRegistry && state.phase === 'allocated') observeStage(event);
    },
  });
  try {
    const teams = await allocateDemoTeams(app, rosters);
    for (const {
      address,
      assignment: { task, team },
    } of teams) {
      const lane = lanes.get(task.id);
      if (!lane) continue;
      setLane(lane, 'assigned');
      lane.address.textContent = `Allocated team: ${address}`;
      lane.address.hidden = false;
      for (const [role, row] of lane.stages) {
        const pin = team[role];
        required('.stage-definition', row).textContent = `Pinned: ${pin.id}@${pin.revision}`;
        const grants = required<HTMLElement>('.stage-grants', row);
        grants.textContent = `Evidence grants: ${pin.evidenceGrants.join(', ')}`;
        grants.hidden = false;
      }
    }
    showDefinitions();
    registryStatus.textContent =
      'Reviewer retired for new assignments. Checkout keeps reviewer@1; Profile keeps reviewer@2.';
    runStatus.textContent = 'Both teams are idle. No specialist sessions have started.';
    state = { phase: 'allocated', app, teams };
  } catch (error) {
    await app.stop();
    throw error;
  }
}

function observeStage(event: StageProgress) {
  const lane = lanes.get(event.taskId);
  const row = lane?.stages.get(event.role);
  if (!lane || !row) return;
  // Display only: a missing or broken observation does not determine the team result.
  const session = required<HTMLElement>('.stage-session', row);
  session.hidden = false;
  session.textContent = `${
    event.status === 'running' ? 'Active session' : 'Ended local session'
  }: ${event.sessionAddress}`;
  if (event.status === 'running') {
    setLane(lane, 'running');
    setStage(row, 'running');
    active.add(event.taskId);
    if (active.size === 2 && !overlapped) {
      overlapped = true;
      runStatus.textContent = 'Both teams have active specialists at the same time.';
    }
  } else {
    active.delete(event.taskId);
    if (event.status === 'completed') {
      setStage(row, 'completed', describeFact(event.fact));
    } else {
      const reason =
        event.reason === 'CHECK_FAILED'
          ? 'The candidate label did not pass the check. Review was not consulted.'
          : event.reason;
      setStage(row, 'refused', reason);
    }
  }
}

async function run() {
  if (state.phase !== 'allocated') return;
  const { app, teams } = state;
  runStatus.textContent = 'Dispatching both workflows…';
  try {
    const results = await runDemoTeams(app, teams, failureOption.checked);
    let completed = 0;
    for (const [index, result] of results.entries()) {
      const {
        address,
        assignment: { task },
      } = teams[index];
      const lane = lanes.get(task.id);
      if (!lane) continue;
      const succeeded = result.status === 'fulfilled' && result.value.ok;
      if (succeeded) completed += 1;
      setLane(lane, succeeded ? 'completed' : 'refused');
      const addressLabel = result.status === 'fulfilled' ? 'Ended local team' : 'Team address';
      lane.address.textContent = `${addressLabel}: ${address}`;
      for (const row of lane.stages.values()) {
        if (row.dataset.state === 'pending' && result.status === 'fulfilled' && !succeeded) {
          setStage(row, 'skipped');
        }
        if (row.dataset.state === 'running' && result.status === 'rejected') {
          setStage(row, 'refused', 'No stage result received.');
          const session = required<HTMLElement>('.stage-session', row);
          session.textContent =
            session.textContent?.replace('Active session:', 'Last observed session:') ?? '';
        }
      }
    }
    const unexpected = results.find((result) => result.status === 'rejected');
    if (unexpected) throw unexpected.reason;
    const overlap = overlapped ? ' The team runs overlapped.' : '';
    runStatus.textContent = `${completed} of 2 teams completed.${overlap} Reset to start a new demo.`;
  } finally {
    state = { phase: 'finished' };
    await app.stop();
  }
}

async function reset() {
  if (state.phase === 'allocated') await state.app.stop();
  state = { phase: 'empty' };
  registry = new DefinitionRegistry();
  active.clear();
  overlapped = false;
  failureOption.checked = false;
  definitionRows.clear();
  definitionList.replaceChildren();
  resetLanes();
  registryStatus.textContent = 'No definitions published.';
  runStatus.textContent =
    'Start by publishing definitions. No provider, credentials, or workspace needed.';
}

resetLanes();
syncControls();
publishButton.addEventListener('click', () => void handle(publish));
allocateButton.addEventListener('click', () => void handle(allocate));
runButton.addEventListener('click', () => void handle(run));
resetButton.addEventListener('click', () => void handle(reset));
