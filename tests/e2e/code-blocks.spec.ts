import { test, expect } from '@playwright/test';

let requests: string[] = [];
test.beforeEach(async ({ page }, testInfo) => {
  requests = [];
  if (testInfo.title.includes('loading failure'))
    await page.route('**/assets/mermaid-renderer-*.js', (route) => route.abort());
  page.on('request', (request) => requests.push(request.url()));
  if (testInfo.title.includes('lazy'))
    await page.addInitScript(() => {
      (window as any).plainFixture = true;
    });
  await page.goto('/@fs' + process.cwd() + '/packages/web-editor/dist/index.html');
  await page.waitForFunction(() => !!(window as any).TioEditor);
  await page.evaluate(async (root) => {
    const { MemoryRepository } = await import(root + '/packages/provider-memory/src/index.ts');
    const { sampleWorkspace } = await import(root + '/packages/workspace/src/index.ts');
    const objects = sampleWorkspace('en');
    const target = objects.find((o: any) => o.type === 'page');
    target.blocks = [
      {
        id: 'js',
        type: 'codeBlock',
        props: { language: 'js' },
        content: [{ type: 'text', text: 'const answer = "hello";', styles: {} }],
        children: [],
      },
      {
        id: 'diagram',
        type: 'codeBlock',
        props: { language: 'mermaid', displayMode: 'split' },
        content: [{ type: 'text', text: 'flowchart TD\n A[Start] --> B[Finish]', styles: {} }],
        children: [],
      },
    ];
    if ((window as any).plainFixture)
      target.blocks = [
        {
          id: 'plain',
          type: 'paragraph',
          props: {},
          content: [{ type: 'text', text: 'Plain document', styles: {} }],
          children: [],
        },
      ];
    const repository = new MemoryRepository();
    await repository.commit({ id: 'seed', expectedVersion: 0, changes: objects, assetIds: [] });
    document.body.innerHTML = '<div id="one"></div><div id="two"></div>';
    const mount = (id: string, theme: string) =>
      (window as any).TioEditor.mountEditor(document.getElementById(id), {
        repository,
        workspaceId: objects[0].id,
        target: { id: target.id },
        presentation: { theme, locale: 'en' },
      });
    const one = await mount('one', 'light');
    const two = await mount('two', 'dark');
    Object.assign(window, { fixture: { one, two, repository, target } });
  }, '/@fs' + process.cwd());
});

test('highlights aliases, isolates themes and persists Mermaid modes across editors', async ({
  page,
}) => {
  const one = page.locator('#one');
  const two = page.locator('#two');
  await expect(one.locator('.tio-code-source .shiki').first()).toBeVisible();
  await expect(one.locator('.tio-mermaid-preview svg')).toBeVisible();
  await expect(two.locator('.tio-mermaid-preview svg')).toBeVisible();
  const diagramColors = await page.evaluate(() =>
    ['one', 'two'].map(
      (id) =>
        getComputedStyle(document.querySelector('#' + id + ' .tio-mermaid-preview svg .node rect')!)
          .fill,
    ),
  );
  expect(diagramColors[0]).not.toBe(diagramColors[1]);
  const colors = await page.evaluate(() =>
    ['one', 'two'].map(
      (id) =>
        getComputedStyle(document.querySelector('#' + id + ' .tio-code-source .shiki')!).color,
    ),
  );
  expect(colors[0]).not.toBe(colors[1]);
  await one.getByRole('button', { name: 'Preview', exact: true }).click();
  await page.evaluate(() => (window as any).fixture.one.flush());
  await expect(two.getByRole('button', { name: 'Preview', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(one.locator('.tio-code-source').nth(1)).toBeHidden();
  await page.evaluate(async () => {
    const f = (window as any).fixture;
    await f.one.dispose();
    f.one = await (window as any).TioEditor.mountEditor(document.getElementById('one'), {
      repository: f.repository,
      workspaceId: f.target.workspaceId,
      target: { id: f.target.id },
      presentation: { theme: 'light', locale: 'en' },
    });
  });
  await expect(one.getByRole('button', { name: 'Preview', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.evaluate(() => (window as any).fixture.one.setPresentation({ readOnly: true }));
  await one.getByRole('button', { name: 'Code', exact: true }).click();
  await expect(one.locator('.tio-code-source').nth(1)).toBeVisible();
  const mode = await page.evaluate(async () => {
    const f = (window as any).fixture;
    return (await f.repository.readSnapshot()).entries.find((e: any) => e.object.id === f.target.id)
      .object.blocks[1].props.displayMode;
  });
  expect(mode).toBe('preview');
  await expect(one.getByLabel('Code language').first()).toBeDisabled();
  await page.screenshot({ path: '.tmp/code-blocks-themes.png', fullPage: true });
});

test('edits Mermaid source, recovers from errors and keeps regular code editable', async ({
  page,
}) => {
  const one = page.locator('#one');
  const source = one.locator('.tio-code-source code').nth(1);
  await expect(one.locator('.tio-mermaid-preview svg')).toBeVisible();
  await source.fill('not a valid diagram');
  await expect(one.getByRole('alert')).toContainText('Unable to render diagram');
  await source.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText('sequenceDiagram');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText(' Alice->>Bob: Hello');
  await expect(one.locator('.tio-mermaid-preview svg')).toContainText('Hello');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate(() =>
    navigator.clipboard.writeText('pie title Pets\n  "Cats" : 3\n  "Dogs" : 2'),
  );
  await source.locator('[data-node-view-content-react]').first().click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('ControlOrMeta+V');
  await expect(one.locator('.tio-mermaid-preview svg')).toContainText('Cats');
  await expect(one.locator('.tio-mermaid-preview svg')).toContainText('Dogs');
  const code = one.locator('.tio-code-source code').first();
  await code.fill('const answer = 42;');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await page.keyboard.insertText('console.log(answer)');
  await expect(code).toContainText('console.log(answer)');
  await page.evaluate(() => (window as any).fixture.one.flush());
  await expect(page.locator('#two .tio-code-source code').first()).toContainText(
    'console.log(answer)',
  );
});

test('lazy loads only the required rendering and grammar chunks', async ({ page }) => {
  await expect(page.locator('#one .bn-editor')).toContainText('Plain document');
  expect(
    requests.some((url) => /\/(highlighter|mermaid-renderer|python|typescript)-/.test(url)),
  ).toBe(false);
  await page.evaluate(async () => {
    const f = (window as any).fixture;
    const snapshot = await f.repository.readSnapshot();
    const object = snapshot.entries.find((entry: any) => entry.object.id === f.target.id).object;
    await f.repository.commit({
      id: crypto.randomUUID(),
      expectedVersion: snapshot.version,
      assetIds: [],
      changes: [
        {
          ...object,
          blocks: [
            {
              id: 'lazy-code',
              type: 'codeBlock',
              props: { language: 'javascript' },
              content: [{ type: 'text', text: 'const x = 1', styles: {} }],
              children: [],
            },
          ],
        },
      ],
    });
  });
  await expect(page.locator('#one .tio-code-source .shiki').first()).toBeVisible();
  expect(requests.some((url) => /\/highlighter-/.test(url))).toBe(true);
  expect(requests.some((url) => /\/(mermaid-renderer|python|typescript)-/.test(url))).toBe(false);
  await page.locator('#one').getByLabel('Code language').selectOption('mermaid');
  await expect(page.locator('#one').getByRole('alert')).toBeVisible();
  expect(requests.some((url) => /\/mermaid-renderer-/.test(url))).toBe(true);
});

test('keeps the document editable after optional renderer loading failure', async ({ page }) => {
  const one = page.locator('#one');
  await expect(one.getByRole('alert')).toBeVisible();
  await one.getByRole('button', { name: 'Code', exact: true }).click();
  const source = one.locator('.tio-code-source code').nth(1);
  await source.fill('flowchart LR; A-->B');
  await expect(source).toContainText('flowchart LR; A-->B');
  await page.evaluate(() => (window as any).fixture.one.flush());
  await expect(page.locator('#two .tio-code-source code').nth(1)).toContainText(
    'flowchart LR; A-->B',
  );
});
