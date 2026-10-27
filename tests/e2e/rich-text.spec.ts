import { expect, test, type Page } from '@playwright/test';

import { repoRoot } from '../paths';

async function mount(page: Page) {
  await page.goto('/@fs' + repoRoot + '/packages/web-editor/dist/index.html');
  await page.waitForFunction(() => !!(window as any).TioEditor);
  await page.evaluate(async (root) => {
    const { mountEditor } = (window as any).TioEditor;
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
    const one = await mountEditor(document.getElementById('one')!, {
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
    const end = document.querySelector('#one [data-id="fold"] .bn-inline-content')!;
    const range = document.createRange();
    range.setStart(el, 0);
    range.setEnd(end, end.childNodes.length);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
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
