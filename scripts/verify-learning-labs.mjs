import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Window } from 'happy-dom';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const learningRoot = resolve(repositoryRoot, 'docs/learning');
const weekOneLab = resolve(learningRoot, 'labs/week-01-event-loop-and-mailbox.html');
const learningPages = [
  resolve(learningRoot, 'index.html'),
  resolve(learningRoot, 'week-01-javascript-event-loop-and-actor-mailboxes.html'),
  resolve(learningRoot, 'guide/01-javascript-concurrency-and-mailboxes.html'),
  resolve(learningRoot, 'workbook/01-javascript-concurrency-and-mailboxes.html'),
];
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
    const isHtml = extname(file) === '.html';
    const pattern = isHtml
      ? /href="([^"]+)"/g
      : /\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;

    for (const match of source.matchAll(pattern)) {
      const href = (isHtml ? match[1] : (match[1] ?? match[2])).split('#')[0];
      if (!href || /^(?:https?:|mailto:|tel:|\/\/)/.test(href)) {
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

function verifyLearningPages() {
  const retiredMarkdownPages = [
    resolve(learningRoot, 'week-01-javascript-event-loop-and-actor-mailboxes.md'),
    resolve(learningRoot, 'guide/01-javascript-concurrency-and-mailboxes.md'),
    resolve(learningRoot, 'workbook/01-javascript-concurrency-and-mailboxes.md'),
  ];
  invariant(
    retiredMarkdownPages.every((page) => !existsSync(page)),
    'Week 1 learner-facing pages must use the HTML product surfaces.'
  );

  for (const page of learningPages) {
    invariant(existsSync(page), `Missing learning page: ${page}`);
    const html = readFileSync(page, 'utf8');
    const window = new Window({
      url: `http://localhost/${page.split('/').at(-1)}`,
      settings: { disableJavaScriptEvaluation: false },
    });
    try {
      window.document.write(html);
      const document = window.document;
      const ids = Array.from(document.querySelectorAll('[id]'), (element) => element.id);
      invariant(ids.length === new Set(ids).size, `${page} must not contain duplicate IDs.`);
      invariant(document.title, `${page} must provide a document title.`);
      invariant(document.querySelectorAll('h1').length === 1, `${page} must provide one h1.`);
      invariant(
        document.querySelector('h1, h2, h3')?.tagName === 'H1',
        `${page} must begin its heading hierarchy with the h1.`
      );
      invariant(document.querySelector('.product-nav'), `${page} must provide product navigation.`);
      invariant(
        document.querySelector('a.skip-link[href="#main-content"]'),
        `${page} must provide a skip link.`
      );
      invariant(
        document.querySelector('#main-content'),
        `${page} must provide a main-content target.`
      );
      invariant(
        document.querySelector('link[href$="learning-page.css"]'),
        `${page} must load the shared learning-page stylesheet.`
      );
      const tables = Array.from(document.querySelectorAll('table'));
      if (tables.length > 0) {
        invariant(
          tables.every((table) => table.parentElement?.matches('.table-wrap[tabindex="0"]')),
          `${page} tables must preserve semantics inside keyboard-scrollable wrappers.`
        );
      }
    } finally {
      window.close();
    }
  }

  const guide = readFileSync(learningPages[2], 'utf8');
  const workbook = readFileSync(learningPages[3], 'utf8');
  const learningHome = readFileSync(learningPages[0], 'utf8');
  invariant(
    learningHome.includes('week-01-javascript-event-loop-and-actor-mailboxes.html'),
    'The learning home must link to the complete Week 1 path.'
  );
  invariant(
    guide.includes('id="TOC"'),
    'The Week 1 guide must expose a generated table of contents.'
  );
  invariant(
    workbook.includes('id="TOC"'),
    'The Week 1 workbook must expose a generated table of contents.'
  );
  invariant(
    workbook.replace(/\s+/g, ' ').includes('Select any correlated code line'),
    'The workbook must teach the phase-to-code interaction.'
  );

  return learningPages.length;
}

function verifyWeekOneLab() {
  const html = readFileSync(weekOneLab, 'utf8');
  const scriptMatches = Array.from(html.matchAll(/<script>([\s\S]*?)<\/script>/g));
  invariant(scriptMatches.length === 1, 'Week 1 lab must contain one inline script.');
  const [scriptMatch] = scriptMatches;

  const ids = Array.from(html.matchAll(/id="([^"]+)"/g), (match) => match[1]);
  invariant(ids.length === new Set(ids).size, 'Week 1 lab must not contain duplicate IDs.');

  const window = new Window({
    url: 'http://localhost/week-01.html',
    settings: { disableJavaScriptEvaluation: false },
  });
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

        const codeLines = Array.from(document.querySelectorAll('[data-code-line]'));
        const correlatedCodeLines = codeLines.filter((line) => line.matches('button'));
        invariant(
          codeLines.length > 0,
          `Scenario ${scenarioValue} must render numbered source lines.`
        );
        invariant(
          correlatedCodeLines.length > 0,
          `Scenario ${scenarioValue} must expose code-to-phase navigation.`
        );
        invariant(
          correlatedCodeLines.every(
            (line) => line.querySelector('[data-code-step-reference]')?.textContent
          ),
          `Scenario ${scenarioValue} must show step references beside correlated code.`
        );

        const forwardCodeLine = correlatedCodeLines.find((line) =>
          line.dataset.steps?.split(',').some((step) => Number(step) > 1)
        );
        invariant(
          forwardCodeLine,
          `Scenario ${scenarioValue} must correlate a code line with a later phase.`
        );
        const initialCounter = document.querySelector('#step-counter')?.textContent;
        const selectedCodeLine = forwardCodeLine.dataset.codeLine;
        forwardCodeLine.click();
        invariant(
          document.querySelector('#step-counter')?.textContent !== initialCounter,
          `Scenario ${scenarioValue} code selection must navigate to a correlated phase.`
        );
        invariant(
          document.activeElement?.dataset.codeLine === selectedCodeLine,
          `Scenario ${scenarioValue} code selection must preserve focus after rendering.`
        );
        const resetButton = document.querySelector('#reset');
        invariant(resetButton, 'Week 1 lab must render a Reset button.');
        resetButton.click();

        let stepGuard = 0;
        while (true) {
          stepGuard += 1;
          invariant(
            stepGuard <= MAX_STEPS_PER_SCENARIO,
            `Scenario ${scenarioValue} exceeded ${MAX_STEPS_PER_SCENARIO} steps without reaching its final step.`
          );
          const activeZones = Array.from(document.querySelectorAll('.zone[data-active="true"]'));
          invariant(
            activeZones.length === 1,
            `Scenario ${scenarioValue} must have one active zone.`
          );
          const [activeZone] = activeZones;
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
          const codeStatus = document.querySelector('#code-status')?.textContent ?? '';
          invariant(codeStatus, `Scenario ${scenarioValue} must explain its code correlation.`);
          const zoneCodeReference = activeZone.querySelector('[data-zone-code-reference]');
          invariant(
            zoneCodeReference?.textContent,
            `Scenario ${scenarioValue} must label the active phase with a code reference.`
          );

          const focusedCodeLines = Array.from(
            document.querySelectorAll('[data-code-line][data-focus]')
          );
          invariant(
            focusedCodeLines.every((line) =>
              ['executing', 'related', 'host'].includes(line.dataset.focus)
            ),
            `Scenario ${scenarioValue} must use a supported code-focus state.`
          );
          invariant(
            focusedCodeLines.every(
              (line) => line.getAttribute('aria-describedby') === 'code-status'
            ),
            `Scenario ${scenarioValue} focused code lines must describe the current step.`
          );
          if (codeStatus.startsWith('Executing') || codeStatus.startsWith('Related')) {
            invariant(
              focusedCodeLines.length > 0,
              `Scenario ${scenarioValue} must highlight code for executing or related work.`
            );
          }
          stateCount += 1;

          const nextButton = document.querySelector('#next');
          invariant(nextButton, 'Week 1 lab must render a Next button.');
          invariant(!nextButton.disabled, 'Step controls must remain keyboard-focusable.');
          if (nextButton.getAttribute('aria-disabled') === 'true') {
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
const pageCount = verifyLearningPages();
const result = verifyWeekOneLab();
console.log(
  `Learning products verified: ${pageCount} web pages, ${result.projections} lab projections, ${result.scenarios} scenarios, ${result.states} states.`
);
