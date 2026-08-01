import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Window } from 'happy-dom';

import { PUBLISHABLE_LEARNING_EXTENSIONS } from '../docs/site/scripts/learning-publication-contract.mjs';

const verifierPath = fileURLToPath(import.meta.url);
const repositoryRoot = resolve(dirname(verifierPath), '..');
const learningRoot = resolve(repositoryRoot, 'docs/learning');
const weekOneLab = resolve(learningRoot, 'labs/week-01-event-loop-and-mailbox.html');
const learningPages = [
  resolve(learningRoot, 'index.html'),
  resolve(learningRoot, 'week-01-javascript-event-loop-and-actor-mailboxes.html'),
  resolve(learningRoot, 'guide/01-javascript-concurrency-and-mailboxes.html'),
  resolve(learningRoot, 'workbook/01-javascript-concurrency-and-mailboxes.html'),
  weekOneLab,
];
const MAX_STEPS_PER_SCENARIO = 100;
const SITE_BASE_PATH = '/actor-web/';
const ACTOR_WEB_EVIDENCE_REVISION = '0552a23c8dbcdc40d175cf7f84099919b7d85dac';

function invariant(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function relativeLuminance(hexColor) {
  const channels = hexColor
    .slice(1)
    .match(/.{2}/g)
    .map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(foreground, background) {
  const luminances = [relativeLuminance(foreground), relativeLuminance(background)].sort(
    (left, right) => right - left
  );
  return (luminances[0] + 0.05) / (luminances[1] + 0.05);
}

function mixHex(foreground, foregroundWeight, background) {
  const foregroundChannels = foreground
    .slice(1)
    .match(/.{2}/g)
    .map((channel) => Number.parseInt(channel, 16));
  const backgroundChannels = background
    .slice(1)
    .match(/.{2}/g)
    .map((channel) => Number.parseInt(channel, 16));
  const mixedChannels = foregroundChannels.map((channel, index) =>
    Math.round(channel * foregroundWeight + backgroundChannels[index] * (1 - foregroundWeight))
  );
  return `#${mixedChannels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

function extractCssBlock(source, prelude) {
  const preludeStart = source.indexOf(prelude);
  if (preludeStart === -1) return null;
  const openingBrace = source.indexOf('{', preludeStart + prelude.length);
  if (openingBrace === -1) return null;

  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] !== '}') continue;
    depth -= 1;
    if (depth === 0) return source.slice(openingBrace + 1, index);
  }
  return null;
}

function collectFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? collectFiles(path) : [path];
  });
}

function collectHtmlHrefs(file, source) {
  const window = new Window({ url: `http://localhost/${file.split('/').at(-1)}` });
  try {
    window.document.write(source.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ''));
    return Array.from(window.document.querySelectorAll('[href]'), (element) =>
      element.getAttribute('href')
    ).filter((href) => href !== null);
  } finally {
    window.close();
  }
}

function isWithinLearningRoot(target) {
  const pathFromLearningRoot = relative(learningRoot, target);
  return (
    pathFromLearningRoot !== '..' &&
    !pathFromLearningRoot.startsWith(`..${sep}`) &&
    !isAbsolute(pathFromLearningRoot)
  );
}

function isPublishableLearningTarget(target) {
  return PUBLISHABLE_LEARNING_EXTENSIONS.has(extname(target));
}

function classifyLearningHref(file, href) {
  const trimmedHref = href.trim();
  if (
    !trimmedHref ||
    trimmedHref.startsWith('#') ||
    trimmedHref.startsWith('//') ||
    /^[a-z][a-z\d+.-]*:/i.test(trimmedHref)
  ) {
    return { kind: 'non-local' };
  }

  const encodedPath = trimmedHref.split(/[?#]/, 1)[0];
  if (!encodedPath) {
    return { kind: 'non-local' };
  }

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(encodedPath);
  } catch {
    return { kind: 'invalid', message: `Invalid percent-encoded link: ${href}` };
  }

  if (decodedPath.startsWith('/')) {
    if (!decodedPath.startsWith(SITE_BASE_PATH)) {
      return {
        kind: 'invalid',
        message: `Root-relative link must use the ${SITE_BASE_PATH} site base: ${href}`,
      };
    }

    const siteRelativePath = decodedPath.slice(SITE_BASE_PATH.length);
    if (siteRelativePath !== 'learning' && !siteRelativePath.startsWith('learning/')) {
      return {
        kind: 'invalid',
        message: `Learning verification cannot resolve this site-root path: ${href}`,
      };
    }
    const target = resolve(repositoryRoot, 'docs', siteRelativePath);
    if (!isWithinLearningRoot(target)) {
      return {
        kind: 'invalid',
        message: `Root-relative learning link escapes the learning root: ${href}`,
      };
    }
    return { kind: 'local', target };
  }

  const target = resolve(dirname(file), decodedPath);
  if (extname(file) === '.html' && !isWithinLearningRoot(target)) {
    return {
      kind: 'invalid',
      message: `Published learning link escapes the learning root: ${href}`,
    };
  }

  return { kind: 'local', target };
}

function verifyLearningHrefClassification() {
  const guidePage = resolve(learningRoot, 'guide/chapter.html');
  invariant(
    classifyLearningHref(guidePage, '../index.html?source=guide#week-one').target ===
      resolve(learningRoot, 'index.html'),
    'Local link verification must remove query strings and fragments.'
  );
  invariant(
    classifyLearningHref(guidePage, '../workbook/Week%201.html').target ===
      resolve(learningRoot, 'workbook/Week 1.html'),
    'Local link verification must decode percent-encoded paths.'
  );
  invariant(
    classifyLearningHref(guidePage, 'data:text/plain,example').kind === 'non-local',
    'Non-hierarchical schemes must not be resolved as filesystem paths.'
  );
  invariant(
    classifyLearningHref(guidePage, '/actor-web/learning/index.html').target ===
      resolve(learningRoot, 'index.html'),
    'Root-relative learning links must resolve through the GitHub Pages site base.'
  );
  invariant(
    classifyLearningHref(guidePage, '/learning/index.html').kind === 'invalid',
    'Root-relative links outside the GitHub Pages site base must fail closed.'
  );
  invariant(
    classifyLearningHref(guidePage, '/actor-web/learning/../../package.json').kind === 'invalid',
    'Root-relative learning links must not escape the learning root after normalization.'
  );
  invariant(
    classifyLearningHref(guidePage, '../../../package.json').kind === 'invalid',
    'Published relative learning links must not escape the copied learning root.'
  );
  invariant(
    classifyLearningHref(
      resolve(learningRoot, 'guide/README.md'),
      '../../actor-web-architecture-study-guide.md'
    ).target === resolve(repositoryRoot, 'docs/actor-web-architecture-study-guide.md'),
    'Repository-only Markdown may link from the learning trail to source documentation.'
  );
  invariant(
    !isPublishableLearningTarget(classifyLearningHref(guidePage, '../README.md').target),
    'Published HTML targets must use an extension copied into the Pages artifact.'
  );
  invariant(
    classifyLearningHref(guidePage, '../workbook/%E0%A4%A.html').kind === 'invalid',
    'Malformed percent-encoded links must fail closed.'
  );
  invariant(
    collectHtmlHrefs(
      guidePage,
      '<a HREF="double.html"></a><a href=unquoted.html></a><a href=\'single.html\'></a>'
    ).join('|') === 'double.html|unquoted.html|single.html',
    'HTML link verification must parse case-insensitive, quoted, and unquoted href attributes.'
  );
}

function verifyLocalLinks() {
  const learningFiles = collectFiles(learningRoot).filter((path) =>
    ['.html', '.md'].includes(extname(path))
  );
  const linkErrors = [];

  for (const file of learningFiles) {
    const source = readFileSync(file, 'utf8');
    const isHtml = extname(file) === '.html';
    const hrefs = isHtml
      ? collectHtmlHrefs(file, source)
      : Array.from(
          source.matchAll(
            /\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g
          ),
          (match) => match[1] ?? match[2]
        );

    for (const href of hrefs) {
      const classification = classifyLearningHref(file, href);
      if (classification.kind === 'non-local') {
        continue;
      }
      if (classification.kind === 'invalid') {
        linkErrors.push(`${file}: ${classification.message}`);
        continue;
      }

      if (isHtml && !isPublishableLearningTarget(classification.target)) {
        linkErrors.push(`${file}: HTML link targets an unpublished file: ${href}`);
        continue;
      }

      if (!existsSync(classification.target)) {
        linkErrors.push(`${file}: ${href}`);
      }
    }
  }

  invariant(linkErrors.length === 0, `Invalid local learning links:\n${linkErrors.join('\n')}`);
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
    });
    try {
      window.document.write(html.replace(/<script>[\s\S]*?<\/script>/g, ''));
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
        !document.querySelector('main .product-nav'),
        `${page} product navigation must remain outside the main-content skip target.`
      );
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
      if (page === learningPages[0]) {
        const weekOneHeading = Array.from(document.querySelectorAll('h2')).find((heading) =>
          heading.textContent.trim().startsWith('Week 1:')
        );
        const weekOneSection = weekOneHeading?.closest('section');
        const productCards = Array.from(weekOneSection?.querySelectorAll('.product-card') ?? []);
        invariant(
          weekOneSection &&
            productCards.length === 3 &&
            productCards.every((card) => card.querySelector('h3')),
          'The learning home must nest three h3 product cards beneath the Week 1 h2.'
        );
      }
      if (page === weekOneLab) {
        const activeLiveRegions = Array.from(
          document.querySelectorAll('[aria-live]:not([aria-live="off"])')
        );
        invariant(
          activeLiveRegions.length === 1 &&
            activeLiveRegions[0].matches('.explanation[aria-live="polite"][aria-atomic="true"]'),
          'The Week 1 lab must use its explanation as the sole active live region.'
        );
      }
      const tables = Array.from(document.querySelectorAll('table'));
      if (tables.length > 0) {
        invariant(
          tables.every((table) => {
            const wrapper = table.parentElement;
            return (
              wrapper?.matches('.table-wrap[tabindex="0"][role="region"]') &&
              Boolean(wrapper.getAttribute('aria-label') || wrapper.getAttribute('aria-labelledby'))
            );
          }),
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
  const lab = readFileSync(weekOneLab, 'utf8');
  const normalizedGuide = guide.replace(/\s+/g, ' ');
  const architectureGuide = readFileSync(
    resolve(repositoryRoot, 'docs/actor-web-architecture-study-guide.md'),
    'utf8'
  );
  const normalizedArchitectureGuide = architectureGuide.replace(/\s+/g, ' ');
  const learningStylesheet = readFileSync(
    resolve(learningRoot, 'assets/learning-page.css'),
    'utf8'
  );
  const learningPageTemplate = readFileSync(
    resolve(learningRoot, 'templates/learning-page.html5'),
    'utf8'
  );
  invariant(
    learningHome.includes('week-01-javascript-event-loop-and-actor-mailboxes.html'),
    'The learning home must link to the complete Week 1 path.'
  );
  invariant(
    /\.product-card h2,\s*\.product-card h3\s*{/.test(learningStylesheet),
    'Guide, workbook, and lab cards must share compact heading styles across h2 and h3.'
  );
  invariant(
    ['$guidehref$', '$workbookhref$', '$labhref$', '$weeklabel$', '$topiclabel$'].every((token) =>
      learningPageTemplate.includes(token)
    ) && !learningPageTemplate.includes('01-javascript-concurrency-and-mailboxes.html'),
    'The reusable learning template must require chapter-specific navigation and footer metadata.'
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
  invariant(
    lab.includes("fixture.sendAndVerifyAdmission(actor, { type: 'A' })") &&
      lab.includes('FIFO follows admission order, not concurrent call order'),
    'The sequential actor lesson must independently verify admission before claiming FIFO.'
  );
  invariant(
    lab.includes("fixture.sendAndVerifyAdmission(actorA, { type: 'CPU_HEAVY' })") &&
      lab.includes("fixture.sendAndVerifyAdmission(actorB, { type: 'FAST' })") &&
      lab.includes('fixture.releaseActorAProcessingFirst();'),
    "The shared-isolate lesson must establish both admissions and actor A's processing turn."
  );
  invariant(
    lab.includes('await Promise.all(admissions); // independent accepted-enqueue facts') &&
      lab.includes('local admission settles before processing turn 1') &&
      workbook
        .replace(/\s+/g, ' ')
        .includes('Concurrent <code>send(...)</code> invocation alone does not prove'),
    'The 101-message lesson must establish its complete-admission boundary.'
  );
  invariant(
    lab.includes('fixture keeps network pending through the zero-timer turn') &&
      lab.includes("setTimeout(() => resolve('DATA'), 25)") &&
      lab.includes('an already-fulfilled Promise would produce a different order'),
    'The awaited-I/O lesson must prove that its fixture remains pending through timer progress.'
  );
  invariant(
    workbook.replace(/\s+/g, ' ').includes('hold actor processing in a controlled harness') &&
      workbook.includes('<code>await actorA.send(PRIMARY)</code>') &&
      workbook.includes('<code>await actorB.send(FAST)</code>') &&
      workbook.includes('<code>fixture.releaseActorAProcessingFirst()</code>') &&
      workbook.includes("do not release actor B's"),
    'The two-actor workbook experiment must establish admission and release actor A first.'
  );
  invariant(
    /\.phase\.phase-last::after\s*{[^}]*color: var\(--muted\);/s.test(lab),
    'The phase-loop return label must use an AA-capable text token.'
  );
  const mobileLabStyles = extractCssBlock(lab, '@media (max-width: 800px)');
  const mobileLabPage = extractCssBlock(mobileLabStyles ?? '', '.lab-page');
  const mobilePhaseConnector = extractCssBlock(
    mobileLabStyles ?? '',
    '.phase::after,\n        .phase.phase-last::after'
  );
  invariant(
    mobileLabPage?.includes('width: min(100% - 20px, 1480px);') &&
      mobileLabPage.includes('padding-top: 18px;'),
    'The mobile lab-page rule must override the base class width and padding.'
  );
  invariant(
    mobilePhaseConnector?.includes('left: auto;') &&
      mobilePhaseConnector.includes('content: "↓";') &&
      mobilePhaseConnector.includes('transform: translateX(50%);'),
    'The mobile phase connector must reset the higher-specificity final loop connector.'
  );
  const darkThemeStyles = extractCssBlock(
    learningStylesheet,
    '@media (prefers-color-scheme: dark)'
  );
  const themeBlocks = [
    extractCssBlock(learningStylesheet, ':root'),
    extractCssBlock(darkThemeStyles ?? '', ':root'),
  ];
  const themeColor = (block, token) =>
    block?.match(new RegExp(`--${token}:\\s*(#[\\da-f]{6})`, 'i'))?.[1];
  invariant(
    themeBlocks.every((block) => {
      const muted = themeColor(block, 'muted');
      const panelSoft = themeColor(block, 'panel-soft');
      return Boolean(muted && panelSoft) && contrastRatio(muted, panelSoft) >= 4.5;
    }),
    'The phase-loop text token must meet WCAG AA against the diagram base in both themes.'
  );
  invariant(
    /\.source-line::before\s*{[^}]*color: var\(--code-ink\);/s.test(lab) &&
      themeBlocks.every((block) => {
        const code = themeColor(block, 'code');
        const codeInk = themeColor(block, 'code-ink');
        const accent = themeColor(block, 'accent');
        const lineStrong = themeColor(block, 'line-strong');
        const success = themeColor(block, 'success');
        if (!code || !codeInk || !accent || !lineStrong || !success) return false;
        const sourceLineBackgrounds = [
          code,
          mixHex(accent, 0.24, code),
          mixHex(lineStrong, 0.18, code),
          mixHex(success, 0.13, code),
        ];
        return sourceLineBackgrounds.every(
          (background) => contrastRatio(codeInk, background) >= 4.5
        );
      }),
    'Source-line numbers must meet WCAG AA in both themes and every focus state.'
  );
  invariant(
    lab.includes('report(type, admitted); // false when dropped') &&
      lab.includes('continue so E is attempted after D fails'),
    'Overflow listings must expose drop results and preserve later fail attempts.'
  );
  invariant(
    normalizedGuide.includes('prevents overlapping <em>actor-owned</em> context mutation') &&
      normalizedGuide.includes('does not deep-clone or freeze every') &&
      normalizedGuide.includes('concurrent sends can overlap suspended') &&
      normalizedGuide.includes('Synchronous test mode is an explicit exception'),
    'The guide must qualify serialized mutation with the external-reference boundary.'
  );
  invariant(
    guide.includes('one-time bootstrap only') &&
      guide.includes('pending callbacks &lt;------------------------------------+') &&
      !guide.includes('startup-compatible timers\n          |\n          v\npending callbacks'),
    'The Node phase diagram must keep bootstrap timers outside the recurring loop.'
  );
  invariant(
    guide.includes(`blob/${ACTOR_WEB_EVIDENCE_REVISION}/packages/`) &&
      workbook.includes(`blob/${ACTOR_WEB_EVIDENCE_REVISION}/packages/`) &&
      !guide.includes('blob/main/packages/') &&
      !workbook.includes('blob/main/packages/'),
    'Actor-Web runtime evidence links must use the reviewed immutable revision.'
  );
  invariant(
    architectureGuide.includes(
      'Bound queued work; the actor runtime serializes message handling per actor'
    ),
    'The architecture guide must distinguish mailbox pressure from runtime serialization.'
  );
  invariant(
    architectureGuide.includes(
      'local snapshots and payloads still rely on immutable-value discipline'
    ),
    'The architecture guide must not imply that local context and payload references are cloned.'
  );
  invariant(
    architectureGuide.includes('normal local processing loop and when callers') &&
      architectureGuide.includes('overlapping actor-owned context mutation') &&
      architectureGuide.includes('synchronous test mode as an exception'),
    'The architecture exit test must scope serialization to normal processing and immutable values.'
  );
  invariant(
    architectureGuide.includes('authenticated principal without retained credential material') &&
      architectureGuide.includes('removes raw tokens, passwords') &&
      !architectureGuide.includes('credential-free principal'),
    'The architecture guide must define principal sanitization after host authentication.'
  );
  invariant(
    normalizedArchitectureGuide.includes(
      "adapter's declared idempotency-key scope and retention window"
    ) &&
      normalizedArchitectureGuide.includes(
        'production claim additionally requires provider-side evidence'
      ) &&
      normalizedArchitectureGuide.includes('where is the provider-side evidence?'),
    'The capstone must bound duplicate-effect proof to evidenced provider idempotency semantics.'
  );
  invariant(
    normalizedGuide.includes('internal bounded-mailbox implementation supports') &&
      normalizedGuide.includes('Spawned actors currently use a fixed dropping mailbox') &&
      normalizedGuide.includes('public runtime API does not expose'),
    'The maturity ledger must distinguish internal overflow policies from spawned-actor APIs.'
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
    settings: { enableJavaScriptEvaluation: true },
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
      for (const option of scenarioSelect.options) {
        if (option.value.startsWith('overflow-')) {
          const policy = option.value.slice('overflow-'.length);
          const policyLabel = policy.charAt(0).toUpperCase() + policy.slice(1);
          invariant(
            option.textContent === `Mailbox overflow: ${policyLabel}`,
            `Scenario ${option.value} must display its policy in title case.`
          );
        }
      }

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
        const nextButton = document.querySelector('#next');
        invariant(nextButton, 'Week 1 lab must render a Next button.');
        nextButton.click();
        invariant(
          document.activeElement?.dataset.codeLine === selectedCodeLine,
          `Scenario ${scenarioValue} step rendering must preserve focused source-line identity.`
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

function verifyWeekOneLabIsolated() {
  const child = spawnSync(
    process.execPath,
    [
      '--permission',
      `--allow-fs-read=${repositoryRoot}`,
      '--disallow-code-generation-from-strings',
      '--frozen-intrinsics',
      verifierPath,
      '--verify-week-one-lab-child',
    ],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
      timeout: 15_000,
      maxBuffer: 1_000_000,
    }
  );
  invariant(
    child.status === 0,
    `Isolated Week 1 lab verification failed${child.signal ? ` (${child.signal})` : ''}${child.error ? `: ${child.error.message}` : ''}:\n${child.stderr || child.stdout}`
  );

  try {
    return JSON.parse(child.stdout.trim());
  } catch (error) {
    throw new Error(
      `Isolated Week 1 lab verification returned invalid JSON: ${error instanceof Error ? error.message : 'unknown parse failure'}`
    );
  }
}

if (process.argv[2] === '--verify-week-one-lab-child') {
  invariant(
    process.permission?.has('fs.write') === false &&
      process.permission.has('child') === false &&
      process.permission.has('worker') === false,
    'The lab evaluator child must deny filesystem writes, subprocesses, and workers.'
  );
  console.log(JSON.stringify(verifyWeekOneLab()));
} else {
  verifyLearningHrefClassification();
  verifyLocalLinks();
  const pageCount = verifyLearningPages();
  const result = verifyWeekOneLabIsolated();
  console.log(
    `Learning products verified: ${pageCount} web pages, ${result.projections} lab projections, ${result.scenarios} scenarios, ${result.states} states.`
  );
}
