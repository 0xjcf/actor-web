import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { paginateItems } from './logistics-view-model';
import {
  createLogisticsRuntimeGatewayServer,
  type LogisticsRuntimeGatewayServer,
} from './server-runtime-gateway';

function flush(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

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
    });
    Object.assign(globalThis, { WebSocket });

    const { IGNITE_HEADLESS_HOST_ELEMENT_NAME } = await import('./ignite-headless-host-element');
    const element = document.createElement(IGNITE_HEADLESS_HOST_ELEMENT_NAME);
    document.body.appendChild(element);
    await waitFor(
      () => element.shadowRoot?.textContent?.includes('connected') ?? false,
      'Expected logistics element to connect to gateway'
    );

    expect(element.shadowRoot?.textContent).toContain('Actor-Web Logistics Control Tower');
    expect(element.shadowRoot?.textContent).toContain('REST ingress');
    expect(element.shadowRoot?.textContent).toContain('Service Worker Runtime');
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

    resetButton.click();
    await flush();
    await flush();

    expect(root.textContent).toContain('idle');
    expect(root.textContent).toContain('SHIPMENT_RESET');
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
});
