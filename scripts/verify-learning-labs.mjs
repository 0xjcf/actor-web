import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Window } from 'happy-dom';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const learningRoot = resolve(repositoryRoot, 'docs/learning');
const weekOneLab = resolve(learningRoot, 'labs/week-01-event-loop-and-mailbox.html');
const MAX_STEPS_PER_SCENARIO = 100;

function invariant(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function collectFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? collectFiles(path) : [path];
  });
}

function verifyLocalLinks() {
  const learningFiles = collectFiles(learningRoot).filter((path) =>
    ['.html', '.md'].includes(extname(path))
  );
  const missingLinks = [];

  for (const file of learningFiles) {
    const source = readFileSync(file, 'utf8');
    const pattern = extname(file) === '.html' ? /href="([^"]+)"/g : /\[[^\]]*\]\(([^)]+)\)/g;

    for (const match of source.matchAll(pattern)) {
      const href = match[1].split('#')[0];
      if (!href || /^(https?:|mailto:)/.test(href)) {
        continue;
      }

      const target = resolve(dirname(file), href);
      if (!existsSync(target)) {
        missingLinks.push(`${file}: ${href}`);
      }
    }
  }

  invariant(missingLinks.length === 0, `Missing local learning links:\n${missingLinks.join('\n')}`);
}

function verifyWeekOneLab() {
  const html = readFileSync(weekOneLab, 'utf8');
  const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
  invariant(scriptMatch, 'Week 1 lab must contain one inline script.');

  const ids = Array.from(html.matchAll(/id="([^"]+)"/g), (match) => match[1]);
  invariant(ids.length === new Set(ids).size, 'Week 1 lab must not contain duplicate IDs.');

  const window = new Window({ url: 'http://localhost/week-01.html' });
  try {
    window.document.write(html.replace(scriptMatch[0], ''));
    window.eval(scriptMatch[1]);

    const document = window.document;
    const projectionButtons = Array.from(document.querySelectorAll('[data-projection-button]'));
    invariant(projectionButtons.length === 3, 'Week 1 must expose three projections.');

    let scenarioCount = 0;
    let stateCount = 0;

    for (const projectionButton of projectionButtons) {
      projectionButton.click();
      const projection = projectionButton.dataset.projectionButton;
      const scenarioSelect = document.querySelector('#scenario');
      invariant(scenarioSelect, `Projection ${projection} must render a scenario selector.`);

      const scenarioValues = Array.from(scenarioSelect.options, (option) => option.value);
      invariant(scenarioValues.length > 0, `Projection ${projection} must contain scenarios.`);

      for (const scenarioValue of scenarioValues) {
        scenarioSelect.value = scenarioValue;
        scenarioSelect.dispatchEvent(new window.Event('change'));
        scenarioCount += 1;

        let stepGuard = 0;
        while (true) {
          stepGuard += 1;
          invariant(
            stepGuard <= MAX_STEPS_PER_SCENARIO,
            `Scenario ${scenarioValue} exceeded ${MAX_STEPS_PER_SCENARIO} steps without disabling Next.`
          );
          const activeZone = document.querySelector('.zone[data-active="true"]');
          invariant(activeZone, `Scenario ${scenarioValue} must have one active zone.`);
          invariant(
            document.querySelector('#step-title')?.textContent,
            `Scenario ${scenarioValue} must render a step title.`
          );
          invariant(
            document.querySelector('#step-detail')?.textContent,
            `Scenario ${scenarioValue} must render step detail.`
          );
          invariant(
            document.querySelector('#prediction-prompt')?.textContent,
            `Scenario ${scenarioValue} must render a prediction prompt.`
          );
          stateCount += 1;

          const nextButton = document.querySelector('#next');
          invariant(nextButton, 'Week 1 lab must render a Next button.');
          if (nextButton.disabled) {
            break;
          }
          nextButton.click();
        }
      }
    }

    invariant(scenarioCount === 11, `Expected 11 Week 1 scenarios, received ${scenarioCount}.`);
    invariant(stateCount === 69, `Expected 69 Week 1 states, received ${stateCount}.`);

    return { projections: projectionButtons.length, scenarios: scenarioCount, states: stateCount };
  } finally {
    window.close();
  }
}

verifyLocalLinks();
const result = verifyWeekOneLab();
console.log(
  `Learning labs verified: ${result.projections} projections, ${result.scenarios} scenarios, ${result.states} states.`
);
