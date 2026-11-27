import { observeLane } from './reader.js';
import { lanes } from './topology.js';

const readers: ReturnType<typeof observeLane>[] = [];
function close() {
  for (const reader of readers.splice(0)) reader.close();
}
const picker = document.querySelector<HTMLInputElement>('#file');
let generation = 0;
async function connect() {
  const active = ++generation;
  close();
  const file = picker?.files?.[0];
  if (!file) return;
  const status = document.querySelector('#status');
  try {
    const config = JSON.parse(await file.text());
    if (active !== generation) return;
    for (const lane of lanes) {
      const reader = observeLane(config.gateway, config.viewers[lane], lane);
      readers.push(reader);
      const panel = document.querySelector(`#${lane}`);
      const render = () => {
        if (panel)
          panel.textContent = `${reader.transportStatus().state}\n${JSON.stringify(reader.snapshot().context ?? {}, null, 2)}`;
      };
      reader.subscribe(render);
      reader.subscribeTransportStatus(render);
    }
    if (status) status.textContent = 'Observing the control gateway.';
  } catch {
    if (active !== generation) return;
    close();
    if (status) status.textContent = 'Cannot open viewer configuration.';
  }
}
picker?.addEventListener('change', connect);
document.querySelector('#reconnect')?.addEventListener('click', connect);
window.addEventListener('pagehide', () => {
  generation++;
  close();
});
