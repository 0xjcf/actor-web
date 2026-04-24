import { afterEach, describe, expect, it } from 'vitest';
import {
  defineIgniteHeadlessHostElement,
  IGNITE_HEADLESS_HOST_ELEMENT_NAME,
} from './ignite-headless-host-element';

function flush(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe('ignite-headless-host element', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders through ignite-element and updates from the actor-web bridge', async () => {
    defineIgniteHeadlessHostElement();

    const element = document.createElement(IGNITE_HEADLESS_HOST_ELEMENT_NAME);
    document.body.appendChild(element);

    expect(element.shadowRoot?.textContent).toContain('Actor-Web Logistics Control Tower');
    expect(element.shadowRoot?.textContent).toContain('REST ingress');
    expect(element.shadowRoot?.textContent).toContain('Service Worker Runtime');
    expect(element.shadowRoot?.textContent).not.toContain('In Transit');
    expect(element.shadowRoot?.textContent).not.toContain('Delivered');

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
    await flush();
    await flush();

    expect(root.textContent).toContain('route-requested');
    expect(root.textContent).toContain('Denver hub');
    expect(root.textContent).toContain('SHIPMENT_CREATED');
    expect(root.textContent).toContain('connected');
    expect(root.textContent).toContain('Lifecycle updates');

    resetButton.click();
    await flush();
    await flush();

    expect(root.textContent).toContain('idle');
    expect(root.textContent).toContain('SHIPMENT_RESET');
  });
});
