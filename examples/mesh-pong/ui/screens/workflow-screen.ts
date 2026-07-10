import type { MeshPongWorkflowProjection } from '../../workflow/mesh-pong-workflow-core';
import { renderLobbyScreen } from './lobby-screen';
import { renderTableScreen } from './table-screen';

export function renderMeshPongWorkflowScreen(
  root: HTMLElement,
  projection: MeshPongWorkflowProjection
): void {
  if (projection.screen === 'lobby') {
    renderLobbyScreen(root, projection);
    return;
  }
  if (projection.screen === 'table') {
    renderTableScreen(root, projection);
    return;
  }

  root.replaceChildren();
  root.dataset.screen = projection.screen;
  const heading = root.ownerDocument.createElement('h2');
  heading.textContent = projection.screen === 'result' ? 'Result' : 'Match';
  const status = root.ownerDocument.createElement('p');
  status.setAttribute('role', 'status');
  status.textContent =
    projection.screen === 'result'
      ? `${projection.winner ?? 'No one'} won.`
      : 'Match lifecycle is owned by MatchCoordinator.';
  root.append(heading, status);
}
