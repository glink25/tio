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
          ],
        }),
        object('page', 'chrome', { id: 'target', title: 'Explicit target', blocks: [] }),
      ],
    });
    document.body.innerHTML = '<div id="one"></div>';
    const mentionRuntime = await WorkspaceRuntime.open(repository);
    const mentions = createMentionService(mentionRuntime, 'chrome', (id: string) => {
      void one.open({ id });
    });
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
    (window as any).chromeFixture = { one, repository };
  }, '/@fs' + repoRoot);
  await expect(page.locator('#one .bn-editor')).toContainText('Select this text');
}
async function selectText(page: Page, root = '#one', touch = false) {
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
  await expect(
    page.locator(touch ? '.tio-mobile-editor-toolbar' : `${root} .bn-formatting-toolbar`),
  ).toBeVisible();
}
test.beforeEach(async ({ page }) => {
  await mount(page);
});
test('multi-block deletion and undo preserve the document', async ({ page }) => {
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
  await page.evaluate(() => (window as any).chromeFixture.one.flush());
  const snapshot = await page.evaluate(() =>
    (window as any).chromeFixture.repository.readSnapshot(),
  );
  expect(JSON.stringify(snapshot)).toContain('Select this text');
  expect(JSON.stringify(snapshot)).toContain('Inside the fold');
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

// Touch formatting crosses a registered portal and keeps a native selection.
// Desktop command tests do not protect this focus hand-off or its shared history.
test.describe('touch editing', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  test('toolbar formatting preserves the selection, saves and shares undo/redo', async ({
    page,
  }) => {
    await selectText(page, '#one', true);
    const toolbar = page.locator('.tio-mobile-editor-toolbar');
    const text = page.locator('#one [data-id="select"] .bn-inline-content');
    await toolbar.locator('[data-test="bold"]').tap();
    await expect(text.locator('strong')).toHaveText('Select this text');
    await page.evaluate(() => (window as any).chromeFixture.one.flush());
    await toolbar.getByRole('button', { name: 'More actions', exact: true }).tap();
    await page.getByRole('button', { name: 'Undo action', exact: true }).tap();
    await expect(text.locator('strong')).toHaveCount(0);
    await toolbar.getByRole('button', { name: 'More actions', exact: true }).tap();
    await page.getByRole('button', { name: 'Redo action', exact: true }).tap();
    await expect(text.locator('strong')).toHaveText('Select this text');
    await page.evaluate(async () => {
      const f = (window as any).chromeFixture;
      await f.one.flush();
      await f.one.open({ id: 'target' });
      await f.one.open({ id: 'main' });
    });
    await expect(page.locator('#one [data-id="select"] strong')).toHaveText('Select this text');
  });
});
