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

    expect(element.shadowRoot?.textContent).toContain('Snapshot + Event Bridge');
    expect(element.shadowRoot?.textContent).toContain('@actor-core/runtime/browser');
    expect(element.shadowRoot?.textContent).toContain('service worker');

    const root = element.shadowRoot;
    const input = root?.querySelector<HTMLInputElement>('input[name="order-id"]');
    const submitButton = root?.querySelector<HTMLButtonElement>('#submit-order');
    const resetButton = root?.querySelector<HTMLButtonElement>('#reset-orders');

    if (!root || !input || !submitButton || !resetButton) {
      throw new Error('Expected ignite-headless-host controls to be rendered.');
    }

    input.value = 'order-4242';
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    submitButton.click();
    await flush();
    await flush();

    expect(root.textContent).toContain('submitted');
    expect(root.textContent).toContain('order-4242');
    expect(root.textContent).toContain('CHECKOUT_SUBMITTED');
    expect(root.textContent).toContain('connected');

    resetButton.click();
    await flush();
    await flush();

    expect(root.textContent).toContain('ready');
    expect(root.textContent).toContain('CHECKOUT_RESET');
  });
});
