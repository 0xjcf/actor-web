/** @jsxImportSource ignite-element/jsx */

import '@ignite-element/renderer/jsx';
import styles from './fas-agent-loop.css?raw';
import { startFasBrowserRuntime } from './fas-browser-runtime';
import type { FasTaskDashboardView } from './fas-contract';
import type { FasDashboardCommands } from './fas-dashboard';

export const FAS_AGENT_LOOP_ELEMENT_NAME = 'aw-fas-agent-loop';

const runtime = startFasBrowserRuntime();

export async function stopFasAgentLoopElementRuntime(): Promise<void> {
  await (await runtime).stop();
}

function taskInputFromForm(event: Event) {
  event.preventDefault();
  if (!(event.currentTarget instanceof HTMLFormElement)) {
    return null;
  }

  const form = new FormData(event.currentTarget);
  const title = String(form.get('title') ?? '').trim();
  const prompt = String(form.get('prompt') ?? '').trim();
  const taskId = String(form.get('taskId') ?? '').trim() || `task-${Date.now().toString(36)}`;

  if (!title || !prompt) {
    return null;
  }

  return {
    taskId,
    title,
    prompt,
  };
}

function renderDashboard(view: FasTaskDashboardView & Pick<FasDashboardCommands, 'runTask'>) {
  const timeline = view.timeline.slice(0, 8);

  return (
    <>
      <style>{styles}</style>
      <main>
        <header>
          <p class="eyebrow">Actor-Web · Integration example</p>
          <h1>Actor Workflow Dashboard</h1>
          <p class="copy">
            Headless-first agent workflow dashboard for inspecting coordination. Submit a
            deterministic task and watch Ignite Element project the coordinator's progress. Tool and
            timeline results are simulated. This dashboard does not run shell commands.
          </p>
        </header>

        <section class="layout">
          <div class="stack">
            <section class="panel">
              <h2>Submit Task</h2>
              <form
                class="form"
                onSubmit={(event: Event) => {
                  const input = taskInputFromForm(event);
                  if (input) {
                    void view.runTask(input);
                  }
                }}
              >
                <label>
                  Task ID
                  <input name="taskId" value="task-ui-1001" />
                </label>
                <label>
                  Title
                  <input name="title" value="Implement production retry policy" />
                </label>
                <label>
                  Prompt
                  <textarea name="prompt">
                    Add bounded retry support for eligible Actor-Web runtime control messages.
                  </textarea>
                </label>
                <button type="submit">Run Workflow</button>
              </form>
            </section>

            <section class="panel">
              <h2>Latest Simulated Tool Call</h2>
              {view.latestToolCall ? (
                <article class="item">
                  <strong>{view.latestToolCall.tool}</strong>
                  <span>{view.latestToolCall.agent}</span>
                  <p class={view.latestToolCall.ok ? 'tool-ok' : 'tool-failed'}>
                    {view.latestToolCall.summary}
                  </p>
                </article>
              ) : (
                <p class="copy">No simulated tool calls yet.</p>
              )}
            </section>
          </div>

          <div class="stack">
            <section class="panel">
              <h2>Dashboard</h2>
              <div class="metrics">
                <div class="metric">
                  <span class="label">Phase</span>
                  <span class="value">{view.phase}</span>
                </div>
                <div class="metric">
                  <span class="label">Active Agent</span>
                  <span class="value">{view.activeAgent}</span>
                </div>
                <div class="metric">
                  <span class="label">Active Task</span>
                  <span class="value">{view.activeTaskId ?? 'none'}</span>
                </div>
                <div class="metric">
                  <span class="label">Validation</span>
                  <span class="value">{view.validationStatus}</span>
                </div>
                <div class="metric">
                  <span class="label">Review</span>
                  <span class="value">{view.reviewStatus}</span>
                </div>
                <div class="metric">
                  <span class="label">Tasks</span>
                  <span class="value">{view.taskCount}</span>
                </div>
              </div>
            </section>

            <section class="panel">
              <h2>Simulated Workflow Timeline</h2>
              {timeline.length > 0 ? (
                <ol class="list">
                  {timeline.map((entry) => (
                    <li class="item">
                      <strong>{entry.label}</strong>
                      <span>
                        {entry.agent} / {entry.phase}
                      </span>
                      <p>{entry.detail}</p>
                    </li>
                  ))}
                </ol>
              ) : (
                <p class="copy">Submit a task to start the workflow.</p>
              )}
            </section>
          </div>
        </section>
      </main>
    </>
  );
}

export const fasAgentLoopElementReady = runtime.then((started) =>
  started.createDashboard()(FAS_AGENT_LOOP_ELEMENT_NAME, renderDashboard)
);

void fasAgentLoopElementReady.catch((error: unknown) => {
  const element = document.querySelector(FAS_AGENT_LOOP_ELEMENT_NAME);
  if (element) element.textContent = 'Could not start the agent workflow example.';
  console.error(error);
});
