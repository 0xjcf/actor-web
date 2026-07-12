import type { PongSide } from '../../pong-contract';
import type { MeshPongWorkflowProjection } from '../../workflow/mesh-pong-workflow-core';

function renderSeat(
  root: HTMLElement,
  projection: MeshPongWorkflowProjection,
  side: PongSide
): void {
  const seat = root.ownerDocument.createElement('article');
  seat.dataset.seat = side;
  const member = projection.members.find((candidate) => candidate.side === side);
  const heading = root.ownerDocument.createElement('h3');
  heading.textContent = `${side === 'left' ? 'Left' : 'Right'} seat`;
  const details = root.ownerDocument.createElement('p');
  details.textContent = member
    ? `${member.sessionId} · ${member.controller} · ${member.connected ? 'connected' : 'disconnected'} · ${member.ready ? 'ready' : 'not ready'}`
    : 'Open';
  seat.append(heading, details);
  root.append(seat);
}

/** Renders room facts; it stores no lifecycle state between renders. */
export function renderTableScreen(root: HTMLElement, projection: MeshPongWorkflowProjection): void {
  root.replaceChildren();
  root.dataset.screen = 'table';
  const heading = root.ownerDocument.createElement('h2');
  heading.textContent = `Table ${projection.roomCode ?? projection.roomId ?? 'pending'}`;
  const status = root.ownerDocument.createElement('p');
  status.setAttribute('role', 'status');
  status.textContent = `${projection.readyCount} / ${projection.requiredReadyCount} ready · room revision ${projection.roomRevision ?? 0}`;
  root.append(heading, status);
  renderSeat(root, projection, 'left');
  renderSeat(root, projection, 'right');
  const authority = root.ownerDocument.createElement('p');
  authority.textContent = projection.isHost
    ? projection.canStart
      ? 'You can start the match.'
      : 'You host this table. Both seats must be ready.'
    : `Host: ${projection.hostSessionId ?? 'pending'}`;
  root.append(authority);
  if (projection.rejection) {
    const alert = root.ownerDocument.createElement('p');
    alert.setAttribute('role', 'alert');
    alert.textContent = `Last command rejected: ${projection.rejection}`;
    root.append(alert);
  }
}
