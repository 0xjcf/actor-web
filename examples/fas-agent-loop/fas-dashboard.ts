import type { IgniteActorSource } from '@actor-core/runtime/browser';
import { igniteCore } from 'ignite-element/actor-web';
import type { FasTaskBoardCommand, FasTaskBoardContext, FasTaskEvent } from './fas-contract';
import { dashboardViewFromContext } from './fas-contract';

export interface FasDashboardTaskInput {
  readonly taskId: string;
  readonly title: string;
  readonly prompt: string;
}

export type FasDashboardCommands = {
  readonly submitTask: (input: FasDashboardTaskInput) => Promise<unknown>;
  readonly runTask: (input: FasDashboardTaskInput) => Promise<unknown>;
} & Readonly<Record<string, (...args: readonly never[]) => unknown>>;

export interface FasDashboardRuntimeOptions {
  readonly runTask?: (input: FasDashboardTaskInput) => Promise<unknown>;
}

export function createFasTaskDashboard(
  source: IgniteActorSource<FasTaskBoardContext, FasTaskBoardCommand, FasTaskEvent>,
  options: FasDashboardRuntimeOptions = {}
) {
  return igniteCore({
    source: () => source,
    view: ({ snapshot }) => dashboardViewFromContext(snapshot.context),
    commands: ({ actor }): FasDashboardCommands => ({
      submitTask(input) {
        return actor.send({ type: 'SUBMIT_TASK', ...input });
      },
      runTask(input) {
        return options.runTask
          ? options.runTask(input)
          : actor.send({ type: 'SUBMIT_TASK', ...input });
      },
    }),
  });
}
