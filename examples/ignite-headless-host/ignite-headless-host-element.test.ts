import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { paginateItems } from './logistics-view-model';
import {
  createLogisticsRuntimeGatewayServer,
  type LogisticsRuntimeGatewayServer,
} from './server-runtime-gateway';

async function waitFor(predicate: () => boolean, message: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) {
      return;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
  }

  throw new Error(message);
}

function normalizeText(value: string | null | undefined): string {
  return value?.replace(/\s+/g, ' ').trim() ?? '';
}

function compactText(value: string | null | undefined): string {
  return value?.replace(/\s+/g, '').trim() ?? '';
}

function countOccurrences(value: string, needle: string): number {
  return value.split(needle).length - 1;
}

describe('logistics view pagination', () => {
  it('normalizes paginated logistics lists', () => {
    const page = paginateItems(
      ['accepted', 'planned', 'scanned', 'packed', 'shipped', 'delivered'],
      1,
      5
    );

    expect(page).toEqual({
      canGoToNextPage: false,
      canGoToPreviousPage: true,
      items: ['delivered'],
      page: 1,
      pageCount: 2,
      total: 6,
    });

    expect(paginateItems(['accepted'], 20, 5)).toMatchObject({
      canGoToNextPage: false,
      canGoToPreviousPage: false,
      items: ['accepted'],
      page: 0,
      pageCount: 1,
      total: 1,
    });
  });
});

describe('ignite-headless-host element', () => {
  let gatewayServer: LogisticsRuntimeGatewayServer | undefined;

  afterEach(async () => {
    document.body.innerHTML = '';
    await import('./logistics-browser-client')
      .then(({ logisticsClient, logisticsServiceWorkerRuntime, logisticsWorkerRuntime }) =>
        Promise.allSettled([
          Promise.resolve(logisticsServiceWorkerRuntime.destroy()),
          Promise.resolve(logisticsWorkerRuntime.destroy()),
          Promise.resolve(logisticsClient.close()),
        ])
      )
      .catch(() => undefined);
    if (gatewayServer) {
      await gatewayServer.stop();
      gatewayServer = undefined;
    }
  });

  it('renders through ignite-element and updates from the actor-web bridge', async () => {
    gatewayServer = createLogisticsRuntimeGatewayServer();
    await gatewayServer.start();
    const gatewayUrl = gatewayServer.getGatewayUrl();
    if (!gatewayUrl) {
      throw new Error('Expected logistics gateway URL');
    }
    Object.assign(import.meta.env, {
      VITE_ACTOR_WEB_GATEWAY_URL: gatewayUrl,
      VITE_ACTOR_WEB_REST_URL: gatewayServer.getRestUrl(),
    });
    Object.assign(globalThis, { WebSocket });

    const { IGNITE_HEADLESS_HOST_ELEMENT_NAME } = await import('./ignite-headless-host-element');
    const element = document.createElement(IGNITE_HEADLESS_HOST_ELEMENT_NAME);
    document.body.appendChild(element);
    await waitFor(
      () => element.shadowRoot?.textContent?.includes('connected') ?? false,
      'Expected logistics element to connect to gateway'
    );
    const runtimeStatusElement = element.shadowRoot?.querySelector(
      'aw-logistics-runtime-status-panel'
    );
    await waitFor(
      () =>
        Boolean(
          runtimeStatusElement?.shadowRoot?.textContent?.includes('Runtime Operator Panel') &&
            runtimeStatusElement.shadowRoot.textContent.includes('simulation') &&
            !runtimeStatusElement.shadowRoot.textContent.includes('Waiting for operator status.')
        ),
      'Expected runtime operator panel to load /runtime/status'
    );

    expect(element.shadowRoot?.textContent).toContain('Actor-Web Logistics Control Tower');
    expect(element.shadowRoot?.textContent).toContain('REST ingress');
    expect(runtimeStatusElement?.shadowRoot?.textContent).toContain('Service Worker Proof');
    expect(runtimeStatusElement?.shadowRoot?.textContent).toContain('Runtime Operator Panel');
    expect(runtimeStatusElement?.shadowRoot?.textContent).toContain('worker disconnected');
    expect(runtimeStatusElement?.shadowRoot?.textContent).toContain('Connected nodes');
    expect(runtimeStatusElement?.shadowRoot?.textContent).toContain('Duplicate drops');
    expect(runtimeStatusElement?.shadowRoot?.textContent).toContain('Provider idempotency errors');
    expect(runtimeStatusElement?.shadowRoot?.textContent).toContain('unavailable');
    const providerElement = element.shadowRoot?.querySelector('aw-logistics-provider-hq-source');
    await waitFor(
      () => providerElement?.shadowRoot?.textContent?.includes('Remote Provider HQ') ?? false,
      'Expected provider HQ source to render'
    );
    expect(providerElement?.shadowRoot?.textContent).toContain('Open Provider HQ Console');
    expect(providerElement?.shadowRoot?.textContent).toContain('Queue');
    const routingElement = element.shadowRoot?.querySelector('aw-logistics-routing-source');
    expect(routingElement?.shadowRoot?.textContent).toContain('Worker Routing Source');
    expect(routingElement?.shadowRoot?.textContent).toContain('worker-owned actor source');
    expect(element.shadowRoot?.textContent).toContain('Page 1 of 1');
    expect(element.shadowRoot?.textContent).not.toContain('In Transit');
    expect(element.shadowRoot?.textContent).toContain('Worker -> Server');
    expect(element.shadowRoot?.textContent).toContain('Gateway WebSocket projection');

    const root = element.shadowRoot;
    const input = root?.querySelector<HTMLInputElement>('input');
    const submitButton = root?.querySelector<HTMLButtonElement>('#create-shipment');
    const resetButton = Array.from(root?.querySelectorAll<HTMLButtonElement>('button') ?? []).find(
      (button) => button.textContent?.includes('Reset')
    );

    if (!root || !input || !submitButton || !resetButton) {
      throw new Error('Expected ignite-headless-host controls to be rendered.');
    }

    input.value = 'Denver hub';
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    submitButton.click();
    await waitFor(
      () => root.textContent?.includes('route-requested') ?? false,
      'Expected shipment command to update the gateway projection'
    );

    expect(root.textContent).toContain('route-requested');
    expect(root.textContent).toContain('Denver hub');
    expect(root.textContent).toContain('SHIPMENT_CREATED');
    expect(root.textContent).toContain('Server Runtime');
    expect(root.textContent).toContain('REST ingress + gateway WS');
    expect(root.textContent).toContain('connected');
    expect(root.textContent).toContain('Shipment actor');
    await waitFor(
      () =>
        Boolean(
          providerElement?.shadowRoot?.textContent?.includes('Denver hub') &&
            providerElement.shadowRoot.textContent.includes('route-requested')
        ),
      'Expected Provider HQ source to project the queued shipment'
    );

    await waitFor(
      () =>
        Array.from(root.querySelectorAll<HTMLButtonElement>('button')).some(
          (button) => button.textContent?.includes('Reset') && !button.disabled
        ),
      'Expected reset button to become enabled after shipment creation.'
    );
    const refreshedResetButton = Array.from(
      root.querySelectorAll<HTMLButtonElement>('button')
    ).find((button) => button.textContent?.includes('Reset') && !button.disabled);
    if (!refreshedResetButton) {
      throw new Error('Expected enabled reset button after shipment creation.');
    }

    const liveProjectionPanel = () =>
      Array.from(root.querySelectorAll<HTMLElement>('section.panel')).find((panel) =>
        panel.textContent?.includes('Live Shipment Projection')
      );
    const eventStreamPanel = () =>
      Array.from(root.querySelectorAll<HTMLElement>('section.panel')).find((panel) =>
        panel.textContent?.includes('Gateway Event Stream')
      );
    if (!liveProjectionPanel()) {
      throw new Error('Expected live shipment projection panel to render.');
    }
    if (!eventStreamPanel()) {
      throw new Error('Expected gateway event stream panel to render.');
    }
    const resetProjectionText = () => compactText(liveProjectionPanel()?.textContent);
    const eventStreamText = () => normalizeText(eventStreamPanel()?.textContent);

    refreshedResetButton.click();
    await waitFor(
      () =>
        Boolean(
          resetProjectionText().includes('Shipmentnone') &&
            resetProjectionText().includes('Destinationnone') &&
            resetProjectionText().includes('Carrierpending') &&
            resetProjectionText().includes('ETApending') &&
            resetProjectionText().includes('RouteNotespendingrouteplan')
        ),
      'Expected shipment reset to clear the live shipment projection'
    );

    expect(resetProjectionText()).toContain('Shipmentnone');
    expect(resetProjectionText()).toContain('Destinationnone');
    expect(countOccurrences(eventStreamText(), 'SHIPMENT_RESET')).toBe(1);
  });

  it('renders the separate provider HQ console page controller', async () => {
    gatewayServer = createLogisticsRuntimeGatewayServer();
    await gatewayServer.start();
    const gatewayUrl = gatewayServer.getGatewayUrl();
    if (!gatewayUrl) {
      throw new Error('Expected logistics gateway URL');
    }
    Object.assign(import.meta.env, {
      VITE_ACTOR_WEB_GATEWAY_URL: gatewayUrl,
      VITE_ACTOR_WEB_REST_URL: gatewayServer.getRestUrl(),
    });
    Object.assign(globalThis, { WebSocket });

    await import('./provider-console');

    const element = document.createElement('aw-provider-console');
    document.body.appendChild(element);
    await waitFor(
      () => element.shadowRoot?.textContent?.includes('Provider scan console') ?? false,
      'Expected provider console to render'
    );

    expect(element.shadowRoot?.textContent).toContain('Remote Provider HQ');
    expect(element.shadowRoot?.textContent).toContain('Provider scan console');
    expect(element.shadowRoot?.textContent).toContain('Operating Mode');
    expect(element.shadowRoot?.textContent).toContain('Provider Queue');
    expect(element.shadowRoot?.textContent).toContain('Current Shipment');
    expect(element.shadowRoot?.textContent).toContain('select from queue');
    expect(element.shadowRoot?.textContent).toContain('Scan Label');
    expect(element.shadowRoot?.textContent).toContain('Report Return');

    expect(element.shadowRoot?.textContent).toContain('Next required signal');
  });

  it('keeps the element import and runtime teardown reusable across remounts', async () => {
    gatewayServer = createLogisticsRuntimeGatewayServer();
    await gatewayServer.start();
    const gatewayUrl = gatewayServer.getGatewayUrl();
    if (!gatewayUrl) {
      throw new Error('Expected logistics gateway URL');
    }
    Object.assign(import.meta.env, {
      VITE_ACTOR_WEB_GATEWAY_URL: gatewayUrl,
      VITE_ACTOR_WEB_REST_URL: gatewayServer.getRestUrl(),
    });
    Object.assign(globalThis, { WebSocket });

    const { IGNITE_HEADLESS_HOST_ELEMENT_NAME } = await import('./ignite-headless-host-element');
    const { logisticsClient, logisticsServiceWorkerRuntime, logisticsWorkerRuntime } = await import(
      './logistics-browser-client'
    );

    const firstElement = document.createElement(IGNITE_HEADLESS_HOST_ELEMENT_NAME);
    document.body.appendChild(firstElement);
    await waitFor(
      () =>
        firstElement.shadowRoot?.textContent?.includes('Actor-Web Logistics Control Tower') ??
        false,
      'Expected first logistics element render'
    );
    firstElement.remove();

    await Promise.allSettled([
      Promise.resolve(logisticsServiceWorkerRuntime.destroy()),
      Promise.resolve(logisticsWorkerRuntime.destroy()),
      Promise.resolve(logisticsClient.close()),
    ]);

    const secondElement = document.createElement(IGNITE_HEADLESS_HOST_ELEMENT_NAME);
    document.body.appendChild(secondElement);
    await waitFor(
      () =>
        secondElement.shadowRoot?.textContent?.includes('Actor-Web Logistics Control Tower') ??
        false,
      'Expected second logistics element render after teardown'
    );
    expect(secondElement.shadowRoot?.textContent).toContain('REST ingress');
    expect(secondElement.shadowRoot?.textContent).toContain('Worker -> Server');
  });
});
