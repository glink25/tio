import { expect, test, type Page } from '@playwright/test';

import { repoRoot } from '../paths';

async function mount(page: Page) {
  await page.goto('/@fs' + repoRoot + '/packages/web-editor/dist/index.html');
  await page.waitForFunction(() => !!(window as any).TioEditor);
  await page.evaluate(async (root) => {
    const { mountEditor } = (window as any).TioEditor;
    const { createMentionService } = await import(root + '/packages/web-editor/src/mentions.ts');
    const { WorkspaceRuntime } = await import(root + '/packages/workspace/src/index.ts');
    const { MemoryRepository } = await import(root + '/packages/provider-memory/src/index.ts');
    const { object } = await import(root + '/packages/core/src/index.ts');
    const text = (
      id: string,
      text: string,
      type = 'paragraph',
      children: any[] = [],
      props = {},
    ) => ({
      id,
      type,
      props,
      content: [{ type: 'text', text, styles: {} }],
      children,
    });
    const reference = (id: string, pageId: string) => ({
      id,
      type: 'paragraph',
      props: {},
      content: [{ type: 'mention', props: { workspaceId: 'chrome', kind: 'page', id: pageId } }],
      children: [],
    });
    const repository = new MemoryRepository();
    await repository.commit({
      id: 'seed',
      expectedVersion: 0,
      assetIds: [],
      changes: [
        object('workspace', 'chrome', { id: 'chrome', name: 'Chrome fixture' }),
        object('page', 'chrome', {
          id: 'main',
          title: 'Editor chrome',
          blocks: [
            text('select', 'Select this text'),
            text('fold', 'Folded section', 'toggleListItem', [text('inside', 'Inside the fold')]),
            text('empty-fold', 'Empty fold', 'toggleListItem'),
            text(
              'fold-heading',
              'Folded heading',
              'heading',
              [text('heading-child', 'Heading child')],
              { level: 2, isToggleable: true },
            ),
            reference('ref', 'target'),
            text('nested', 'Nested reference', 'paragraph', [
              reference('nested-ref', 'target'),
              reference('missing-ref', 'missing'),
            ]),
          ],
        }),
        object('database', 'chrome', {
          id: 'tasks',
          name: 'Tasks',
          fields: [
            { id: 'title', name: 'Name', type: 'title' },
            { id: 'refs', name: 'References', type: 'mention' },
          ],
        }),
        object('record', 'chrome', {
          id: 'task',
          databaseId: 'tasks',
          properties: { title: 'Ship editor', refs: [] },
          blocks: [text('task-body', 'Record body')],
        }),
        object('page', 'chrome', { id: 'target', title: 'Explicit target', blocks: [] }),
        object('page', 'chrome', {
          id: 'child',
          parentId: 'main',
          title: 'Tree-only child',
          blocks: [],
        }),
        object('page', 'chrome', {
          id: 'inbound',
          title: 'Inbound-only page',
          blocks: [reference('inbound-ref', 'main')],
        }),
      ],
    });
    document.body.innerHTML =
      '<button id="host">Host control</button><div id="one"></div><div id="two"></div>';
    const mentionRuntime = await WorkspaceRuntime.open(repository);
    const mentions = createMentionService(
      mentionRuntime,
      'chrome',
      (id: string) => {
        void one.open({ id });
      },
      async () => [
        {
          reference: { workspaceId: 'chrome', kind: 'github-user', id: '42', login: 'octocat' },
          title: '@octocat',
        },
      ],
    );
    const one = await mountEditor(document.getElementById('one')!, {
      mentions,
      repository,
      workspaceId: 'chrome',
      target: { id: 'main' },
      presentation: { locale: 'en', theme: 'light' },
      onNavigate: (target: { id: string }) => {
        void one.open(target);
      },
    });
    const two = await mountEditor(document.getElementById('two')!, {
      repository,
      workspaceId: 'chrome',
      target: { id: 'main' },
      presentation: { locale: 'en', theme: 'dark' },
    });
    (window as any).chromeFixture = { one, two, repository };
  }, '/@fs' + repoRoot);
  await expect(page.locator('#one .bn-editor')).toContainText('Select this text');
}
async function selectText(page: Page, root = '#one') {
  await page.locator(`${root} [data-id="select"] .bn-inline-content`).click();
  await page.locator(`${root} .bn-editor`).evaluate((el) => {
    const editor = (el as HTMLElement & { editor: any }).editor;
    let from: number | undefined;
    editor.state.doc.descendants((node: any, pos: number) => {
      if (from === undefined && node.isText && node.text === 'Select this text') from = pos;
    });
    if (from === undefined) throw new Error('Missing text selection fixture');
    editor.commands.setTextSelection({ from, to: from + 'Select this text'.length });
    editor.view.focus();
  });
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString()))
    .toBe('Select this text');
  await expect(page.locator(`${root} .bn-formatting-toolbar`)).toBeVisible();
}
test.beforeEach(async ({ page }) => {
  await mount(page);
});
test('multi-block deletion, undo and dragging preserve the document', async ({ page }) => {
  const first = page.locator('#one [data-id="select"] .bn-inline-content');
  await first.click();
  await first.evaluate((el) => {
    const editor = (el.closest('.bn-editor') as HTMLElement & { editor: any }).editor;
    let from: number | undefined;
    let to: number | undefined;
    editor.state.doc.descendants((node: any, pos: number) => {
      if (node.isText && node.text === 'Select this text') from = pos;
      if (node.isText && node.text === 'Folded section') to = pos + node.text.length;
    });
    if (from === undefined || to === undefined) throw new Error('Missing multi-block fixture');
    // Native DOM ranges can be replaced by the editor's pending selection transaction.
    editor.commands.setTextSelection({ from, to });
    editor.view.focus();
  });
  await expect(page.locator('#one .bn-formatting-toolbar')).toBeVisible();
  await first.hover();
  const handle = page.locator('#one').getByRole('button', { name: 'Open block menu', exact: true });
  await handle.click();
  await page.locator('#one').getByRole('menuitem', { name: 'Delete', exact: true }).click();
  await expect(page.locator('#one [data-id="select"]')).toHaveCount(0);
  await expect(page.locator('#one [data-id="fold"]')).toHaveCount(0);
  await page.locator('#one .bn-editor').focus();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(first).toBeVisible();
  await expect(page.locator('#one [data-id="fold"] .bn-inline-content').first()).toBeVisible();
  await first.hover();
  await handle.dragTo(page.locator('#one [data-id="nested"] > .bn-block-content'), {
    targetPosition: { x: 100, y: 20 },
  });
  await page.evaluate(() => (window as any).chromeFixture.one.flush());
  const blocks = await page.evaluate(
    () =>
      (window as any).chromeFixture.one.getSaveState().objects.find((o: any) => o.id === 'main')
        .blocks,
  );
  expect(blocks[0].id).not.toBe('select');
  expect(JSON.stringify(blocks)).toContain('Select this text');
});
test('inline mentions support keyboard insertion, atomic deletion and undo', async ({ page }) => {
  const block = page.locator('#one [data-id="select"] .bn-inline-content');
  await selectText(page);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.type(' @Explicit');
  await expect(page.locator('#one .bn-suggestion-menu')).toContainText('Explicit target');
  await page.keyboard.press('Enter');
  await expect(block.getByRole('button', { name: 'Explicit target' })).toBeVisible();
  await page.evaluate(() => (window as any).chromeFixture.one.flush());
  const count = () =>
    page.evaluate(async () => {
      const s = await (window as any).chromeFixture.repository.readSnapshot();
      return s.entries
        .find((e: any) => e.object.id === 'main')
        .object.blocks.find((b: any) => b.id === 'select')
        .content.filter((n: any) => n.type === 'mention').length;
    });
  expect(await count()).toBe(1);
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  await expect(block.getByRole('button', { name: 'Explicit target' })).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(block.getByRole('button', { name: 'Explicit target' })).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.type(' @');
  await page.keyboard.press('Escape');
  await expect(page.locator('#one .bn-suggestion-menu')).toBeHidden();
});

async function insertCode(page: Page, source: string, language = 'html', displayMode?: string) {
  await page.evaluate(
    async (value) => {
      const fixture = (window as any).chromeFixture;
      const snapshot = await fixture.repository.readSnapshot();
      const current = snapshot.entries.find((entry: any) => entry.object.id === 'main').object;
      await fixture.repository.commit({
        id: crypto.randomUUID(),
        expectedVersion: snapshot.version,
        assetIds: [],
        changes: [
          {
            ...current,
            blocks: [
              ...current.blocks,
              {
                id: 'preview-code',
                type: 'codeBlock',
                props: {
                  language: value.language,
                  ...(value.displayMode ? { displayMode: value.displayMode } : {}),
                },
                content: [{ type: 'text', text: value.source, styles: {} }],
                children: [],
              },
            ],
          },
        ],
      });
    },
    { source, language, displayMode },
  );
  return page.locator('#one [data-id="preview-code"]');
}

async function savedCode(page: Page) {
  await page.evaluate(() => (window as any).chromeFixture.one.flush());
  return page.evaluate(async () => {
    const snapshot = await (window as any).chromeFixture.repository.readSnapshot();
    return snapshot.entries
      .find((entry: any) => entry.object.id === 'main')
      .object.blocks.find((block: any) => block.id === 'preview-code');
  });
}

test('HTML code previews execute isolated scripts and load external resources', async ({
  page,
}) => {
  await page.route('https://preview.test/**', (route) => {
    const script = route.request().url().endsWith('.js');
    return route.fulfill({
      contentType: script ? 'application/javascript' : 'text/css',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: script
        ? 'document.getElementById("external").textContent = "External script loaded"'
        : '#external { color: rgb(12, 34, 56); }',
    });
  });
  const source = `<!doctype html><html><head>
    <link rel="stylesheet" href="https://preview.test/style.css"></head><body>
    <div id="external"></div><div id="isolation"></div><div id="sdk"></div>
    <script>
      try { parent.document.body; document.getElementById('isolation').textContent = 'unsafe'; }
      catch { document.getElementById('isolation').textContent = 'isolated'; }
      document.getElementById('sdk').textContent = typeof window.tio;
    </script><script src="https://preview.test/script.js"></script>
    </body></html>`;
  const block = await insertCode(page, source);
  const frame = block.locator('iframe').contentFrame();
  await expect(frame.locator('#external')).toHaveText('External script loaded');
  await expect(frame.locator('#external')).toHaveCSS('color', 'rgb(12, 34, 56)');
  await expect(frame.locator('#isolation')).toHaveText('isolated');
  await expect(frame.locator('#sdk')).toHaveText('undefined');
  await expect(block.locator('iframe')).toHaveAttribute('sandbox', 'allow-scripts');
  await expect(block.locator('iframe')).toHaveAttribute('referrerpolicy', 'no-referrer');
  await expect(block.locator('iframe')).toHaveCSS('height', '400px');
  await expect(block.locator('.tio-code-source')).toBeHidden();
  await frame.locator('#sdk').evaluate((element) => {
    element.textContent = 'running state';
  });
  await page.evaluate(() => (window as any).chromeFixture.one.setPresentation({ theme: 'dark' }));
  await expect(frame.locator('#sdk')).toHaveText('running state');
  await block.getByRole('button', { name: 'Code', exact: true }).click();
  await expect(block.locator('iframe')).toHaveCount(0);
  await expect(block.locator('.tio-code-source')).toBeVisible();
  expect(JSON.stringify(await savedCode(page))).toContain('preview.test');
});

test('HTML modes persist edits and read-only switching stays temporary', async ({ page }) => {
  const block = await insertCode(page, '<p>Before</p>', 'text');
  await expect(block.getByRole('group', { name: 'Display mode' })).toHaveCount(0);
  await block.getByLabel('Code language').selectOption('html');
  await expect(block.locator('.tio-code-block')).toHaveAttribute('data-mode', 'split');
  await block.locator('.tio-code-source code').click();
  await page.locator('#one .bn-editor').evaluate((element) => {
    const editor = (element as HTMLElement & { editor: any }).editor;
    let from: number | undefined;
    editor.state.doc.descendants((node: any, pos: number) => {
      if (node.isText && node.text === '<p>Before</p>') from = pos;
    });
    if (from === undefined) throw new Error('Missing HTML source fixture');
    editor.commands.setTextSelection({ from, to: from + '<p>Before</p>'.length });
    editor.view.focus();
  });
  await page.keyboard.insertText('<p>Edited preview</p>');
  await expect(block.locator('iframe').contentFrame().locator('p')).toHaveText('Edited preview');
  await block.getByRole('button', { name: 'Preview', exact: true }).click();
  const saved = await savedCode(page);
  expect(saved.props).toMatchObject({ language: 'html', displayMode: 'preview' });
  expect(JSON.stringify(saved.content)).toContain('<p>Edited preview</p>');
  await page.evaluate(async () => {
    const fixture = (window as any).chromeFixture;
    await fixture.one.open({ id: 'target' });
  });
  await expect(block).toHaveCount(0);
  await page.evaluate(() => (window as any).chromeFixture.one.open({ id: 'main' }));
  await expect(block.locator('iframe').contentFrame().locator('p')).toHaveText('Edited preview');
  await expect(block.locator('.tio-code-source')).toBeHidden();
  await page.evaluate(() => (window as any).chromeFixture.one.setPresentation({ readOnly: true }));
  await expect(block.getByLabel('Code language')).toBeDisabled();
  await block.getByRole('button', { name: 'Code', exact: true }).click();
  await expect(block.locator('iframe')).toHaveCount(0);
  await block.getByRole('button', { name: 'Split', exact: true }).click();
  await expect(block.locator('.tio-code-source')).toBeVisible();
  await expect(block.locator('iframe').contentFrame().locator('p')).toHaveText('Edited preview');
  expect(await savedCode(page)).toEqual(saved);
  await page.setViewportSize({ width: 390, height: 844 });
  const sourceBox = await block.locator('.tio-code-source').boundingBox();
  const previewBox = await block.locator('.tio-code-preview').boundingBox();
  expect(previewBox!.y).toBeGreaterThanOrEqual(sourceBox!.y + sourceBox!.height);
});

test('Mermaid keeps its preview when using the shared mode controls', async ({ page }) => {
  const block = await insertCode(page, 'flowchart TD\n A --> B', 'text');
  await block.getByLabel('Code language').selectOption('mermaid');
  await expect(block.locator('.tio-code-block')).toHaveAttribute('data-mode', 'split');
  await expect(block.locator('.tio-mermaid-preview svg')).toBeVisible();
  await block.getByRole('button', { name: 'Code', exact: true }).click();
  await expect(block.locator('.tio-mermaid-preview')).toHaveCount(0);
  await block.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(block.locator('.tio-code-source')).toBeHidden();
  await expect(block.locator('.tio-mermaid-preview svg')).toBeVisible();
});

test('history shortcuts belong to the focused surface and support native history input events', async ({
  page,
}) => {
  const one = page.locator('#one').getByRole('textbox', { name: 'Page title' });
  const two = page.locator('#two').getByRole('textbox', { name: 'Page title' });
  await one.fill('Shared title');
  await page.evaluate(() => (window as any).chromeFixture.one.flush());
  await expect(two).toHaveValue('Shared title');
  await two.fill('Second surface');
  await page.evaluate(() => (window as any).chromeFixture.two.flush());
  await two.press('ControlOrMeta+z');
  await expect(two).toHaveValue('Shared title');
  await page.evaluate(() => (window as any).chromeFixture.two.flush());
  await expect(one).toHaveValue('Shared title');
  // One keypress must not also undo the first surface's independent history.
  await two.evaluate((input) =>
    input.dispatchEvent(
      new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'historyRedo' }),
    ),
  );
  await expect(two).toHaveValue('Second surface');
  await two.dispatchEvent('keydown', { key: 'z', ctrlKey: true, isComposing: true });
  await expect(two).toHaveValue('Second surface');
  await page.evaluate(() => (window as any).chromeFixture.two.setPresentation({ readOnly: true }));
  await two.press('ControlOrMeta+z');
  await expect(two).toHaveValue('Second surface');
});

test('record and GitHub mentions insert, persist and open their targets; fields share the same candidates', async ({
  page,
}) => {
  const block = page.locator('#one [data-id="select"] .bn-inline-content');
  await selectText(page);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.type(' @Ship');
  await expect(page.locator('#one .bn-suggestion-menu')).toContainText('Ship editor');
  await expect(page.locator('#one .bn-suggestion-menu')).toContainText('Tasks');
  await page.keyboard.press('Enter');
  await expect(block.getByRole('button', { name: 'Ship editor', exact: true })).toBeVisible();
  await page.keyboard.type('@octo');
  await expect(page.locator('#one .bn-suggestion-menu')).toContainText('@octocat');
  await page.keyboard.press('Enter');
  await expect(block.getByRole('button', { name: '@octocat', exact: true })).toBeVisible();
  await page.evaluate(() => (window as any).chromeFixture.one.flush());
  await page.evaluate(() => (window as any).chromeFixture.two.open({ id: 'main' }));
  await expect(
    page.locator('#two [data-id="select"]').getByRole('button', { name: '@octocat', exact: true }),
  ).toBeVisible();
  await page
    .context()
    .route('https://github.com/**', (route) => route.fulfill({ body: 'GitHub profile fixture' }));
  const popup = page.waitForEvent('popup');
  await block.getByRole('button', { name: '@octocat', exact: true }).click();
  const profile = await popup;
  await expect(profile).toHaveURL('https://github.com/octocat');
  await profile.close();
  await block.getByRole('button', { name: 'Ship editor', exact: true }).click();
  await expect(page.locator('#one h1')).toHaveText('Ship editor');
  await page.locator('#one').getByRole('button', { name: 'References', exact: true }).click();
  await page
    .locator('#one')
    .getByRole('combobox', { name: 'References', exact: true })
    .fill('octo');
  await page.locator('#one').getByRole('option').filter({ hasText: '@octocat' }).click();
  await page.keyboard.press('Escape');
  await page
    .locator('#one')
    .getByRole('group', { name: 'References editor', exact: true })
    .getByRole('button', { name: 'Done', exact: true })
    .click();
  await page.evaluate(() => (window as any).chromeFixture.one.flush());
  const value = await page.evaluate(
    async () =>
      (await (window as any).chromeFixture.repository.readObjects(['task'])).entries[0].object
        .properties.refs,
  );
  expect(value).toEqual([
    { workspaceId: 'chrome', kind: 'github-user', id: '42', login: 'octocat' },
  ]);
});
