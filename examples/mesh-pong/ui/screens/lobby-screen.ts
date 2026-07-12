import type { MeshPongWorkflowProjection } from '../../workflow/mesh-pong-workflow-core';

function appendTextElement(
  root: HTMLElement,
  tagName: 'h2' | 'p',
  text: string,
  attributes: Record<string, string> = {}
): HTMLElement {
  const element = root.ownerDocument.createElement(tagName);
  element.textContent = text;
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, value);
  }
  root.append(element);
  return element;
}

/** Projection adapter only. Commands are supplied by the imperative host. */
export function renderLobbyScreen(root: HTMLElement, projection: MeshPongWorkflowProjection): void {
  root.replaceChildren();
  root.dataset.screen = 'lobby';
  appendTextElement(root, 'h2', 'Lobby');
  appendTextElement(
    root,
    'p',
    projection.connected
      ? `Session ${projection.sessionId} connected. Create or join a room.`
      : `Session ${projection.sessionId} is ${projection.connection}.`,
    { role: 'status' }
  );
  if (projection.rejection) {
    appendTextElement(root, 'p', `Last command rejected: ${projection.rejection}`, {
      role: 'alert',
    });
  }
}
