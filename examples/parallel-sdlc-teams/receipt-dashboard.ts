import { startHeldReceiptFixture } from './receipt-fixture.js';

type Fixture = Awaited<ReturnType<typeof startHeldReceiptFixture>>;
function render(container: HTMLElement, view: ReturnType<Fixture['openDashboard']>) {
  const lanes = Object.values(view.snapshot()).map((row) => {
    const { binding } = row;
    const lane = document.createElement('article');
    lane.className = 'panel team-lane';
    const title = document.createElement('h2');
    title.textContent = `${binding.taskId}@${binding.taskRevision}`;
    const detail = document.createElement('p');
    detail.textContent = `Owner: ${row.ownerPhase} · Document: ${row.documented ? 'complete' : 'not reached'}`;
    const counts = document.createElement('p');
    counts.textContent = `Checks executed: ${row.executions} · Review sessions opened: ${row.reviewSessions}`;
    const source = document.createElement('p');
    source.className = 'task-version';
    source.textContent = `${binding.workspaceId} · ${binding.executorId}@${binding.executorGeneration} · attempt ${binding.attemptId}`;
    lane.append(title, detail, counts, source);
    return lane;
  });
  container.replaceChildren(...lanes);
}

function required<T extends HTMLElement>(id: string): T {
  const element = document.querySelector<T>(id);
  if (!element) throw new Error(`Missing fixture element: ${id}`);
  return element;
}
const start = required<HTMLButtonElement>('#start');
const deliver = required<HTMLButtonElement>('#deliver');
const wrong = required<HTMLInputElement>('#wrong');
const status = required('#status');
const lanes = required('#receipt-lanes');
let fixture: Fixture | undefined;

async function drive(action: () => Promise<void>) {
  start.disabled = deliver.disabled = wrong.disabled = true;
  try {
    await action();
    if (fixture) render(lanes, fixture.openDashboard());
  } catch (error) {
    status.textContent = `Fixture error: ${String(error)}`;
  } finally {
    start.disabled = wrong.disabled = false;
    deliver.disabled = !fixture;
  }
}

start.addEventListener(
  'click',
  () =>
    void drive(async () => {
      await fixture?.stop();
      fixture = undefined;
      lanes.replaceChildren();
      fixture = await startHeldReceiptFixture(wrong.checked);
      status.textContent =
        'Profile finished. Checkout’s check ran, but its receipt has not been delivered.';
    })
);
deliver.addEventListener(
  'click',
  () =>
    void drive(async () => {
      if (!fixture) return;
      const stored = await fixture.lookupCheckout();
      if (stored.type === 'RECEIPT_UNAVAILABLE') {
        status.textContent = 'No stored receipt. Checkout remains held; no check was rerun.';
        return;
      }
      const result = await fixture.deliverCheckout(stored);
      status.textContent = result.ok
        ? 'Checkout resumed and reached Document.'
        : `Receipt delivery: ${result.reason}.`;
    })
);
