import { test, expect, type Page, type Locator } from '@playwright/test';

async function mount(page: Page, development: boolean) {
  await page.goto(
    development ? '/' : '/@fs' + process.cwd() + '/packages/web-editor/dist/index.html',
  );
  if (!development) await page.waitForFunction(() => !!(window as any).TioEditor);
  await page.evaluate(
    async ({ root, development }) => {
      const { mountEditor } = development
        ? await import(root + '/packages/web-editor/src/index.tsx')
        : (window as any).TioEditor;
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
    },
    { root: '/@fs' + process.cwd(), development },
  );
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
async function surface(locator: Locator, dark = false) {
  await expect(locator).toBeVisible();
  await expect(locator).toHaveCSS(
    'background-color',
    dark ? 'rgb(32, 32, 32)' : 'rgb(255, 255, 255)',
  );
  expect(await locator.evaluate((el) => !!el.closest('.tio-editor'))).toBe(true);
  const bounds = await locator.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
}
for (const development of [true, false]) {
  test.describe(development ? 'development editor' : 'standalone build', () => {
    test.beforeEach(async ({ page }) => {
      await mount(page, development);
    });
    test('selection toolbar, block type, colors and link popovers retain selection without ref warnings', async ({
      page,
    }) => {
      const warnings: string[] = [];
      page.on('console', (message) => {
        if (/cannot be given refs|access this ref|check the render method/i.test(message.text()))
          warnings.push(message.text());
      });
      page.on('pageerror', (error) => warnings.push(error.message));
      await selectText(page);
      const toolbar = page.locator('#one .bn-formatting-toolbar');
      await surface(toolbar);
      await toolbar.getByRole('button', { name: 'Bold', exact: true }).click();
      await expect(page.locator('#one [data-id="select"] strong')).toHaveText('Select this text');
      await toolbar.getByRole('combobox').click();
      await surface(page.locator('#one [data-slot="select-content"]'));
      await page.getByRole('option', { name: 'Heading 2', exact: true }).click();
      await expect(page.locator('#one [data-id="select"] h2')).toHaveText('Select this text');
      await selectText(page);
      await toolbar.getByRole('button', { name: 'Colors', exact: true }).click();
      await surface(page.locator('#one .bn-color-picker-dropdown'));
      await page.screenshot({
        animations: 'disabled',
        path: `test-results/chrome-colors-${development}.png`,
      });
      await page.locator('#one [data-test="text-color-red"]').click();
      await selectText(page);
      await toolbar.getByRole('button', { name: 'Colors', exact: true }).click();
      await page.locator('#one [data-test="background-color-yellow"]').click();
      await page.evaluate(() => (window as any).chromeFixture.one.flush());
      const content = await page.evaluate(
        () =>
          (window as any).chromeFixture.one.getSaveState().objects.find((o: any) => o.id === 'main')
            .blocks[0].content,
      );
      expect(content).toMatchObject([
        {
          text: 'Select this text',
          styles: { bold: true, textColor: 'red', backgroundColor: 'yellow' },
        },
      ]);
      await selectText(page);
      await toolbar.getByRole('button', { name: 'Create link', exact: true }).click();
      await surface(page.locator('#one [data-slot="popover-content"]'));
      await expect(page.locator('#one [data-show-selection]').first()).toHaveCSS(
        'background-color',
        'rgb(235, 235, 235)',
      );
      await page.getByPlaceholder('Edit URL').fill('https://example.com');
      await page.getByPlaceholder('Edit URL').press('Enter');
      await expect(page.locator('#one [data-id="select"] a')).toHaveAttribute(
        'href',
        'https://example.com',
      );
      await selectText(page, '#two');
      await surface(page.locator('#two .bn-formatting-toolbar'), true);
      await expect(page.locator('#two .bn-link-toolbar')).toHaveCount(0);
      await expect(
        page
          .locator('#two .bn-formatting-toolbar')
          .getByRole('button', { name: 'Bold', exact: true }),
      ).toHaveCSS('color', 'rgb(238, 238, 238)');
      await page
        .locator('#two .bn-formatting-toolbar')
        .getByRole('button', { name: 'Colors', exact: true })
        .click();
      await surface(page.locator('#two .bn-color-picker-dropdown'), true);
      await page.screenshot({
        animations: 'disabled',
        path: `test-results/chrome-dark-${development}.png`,
      });
      expect(warnings).toEqual([]);
    });
    for (const kind of ['webSlice']) {
      test(`selecting ${kind} never leaves an empty toolbar ring`, async ({ page }) => {
        if (kind === 'webSlice') {
          await page.evaluate(async () => {
            const f = (window as any).chromeFixture;
            const snapshot = await f.repository.readSnapshot();
            const current = snapshot.entries.find((e: any) => e.object.id === 'main').object;
            await f.repository.commit({
              id: crypto.randomUUID(),
              expectedVersion: snapshot.version,
              assetIds: [],
              changes: [
                {
                  ...current,
                  blocks: current.blocks.map((b: any) =>
                    b.id === 'ref'
                      ? {
                          ...b,
                          type: 'webSlice',
                          content: [],
                          props: {
                            title: 'Web Slice',
                            html: '<p>Embedded content</p>',
                            height: 320,
                            autoHeight: false,
                            runtimeVersion: 1,
                          },
                        }
                      : b,
                  ),
                },
              ],
            });
          });
          await expect(page.locator('#one [data-id="ref"] iframe')).toHaveCount(1);
        }
        for (const root of ['#one', '#two']) {
          await page.locator(`${root} .bn-editor`).evaluate((el, blockType) => {
            // Use the editor's selection API: native ArrowLeft has different
            // atom/iframe boundary behavior across operating systems.
            const editor = (el as HTMLElement & { editor: any }).editor;
            let position: number | undefined;
            editor.state.doc.descendants((node: any, pos: number) => {
              if (position === undefined && node.type.name === blockType) position = pos;
            });
            if (position === undefined) throw new Error(`Missing ${blockType} fixture`);
            editor.commands.setNodeSelection(position);
            editor.view.focus();
          }, kind);
          const toolbar = page.locator(`${root} .bn-formatting-toolbar`);
          const selectedNode = page.locator(`${root} .ProseMirror-selectednode`);
          await expect(selectedNode).toHaveCount(1);
          expect(
            await selectedNode.evaluate((el) => el.closest('[data-id]')?.getAttribute('data-id')),
          ).toBe('ref');
          await expect(toolbar).toBeHidden();
          await page.screenshot({
            animations: 'disabled',
            path: `test-results/chrome-contentless-${kind}-${development}-${root.slice(1)}.png`,
          });
          await selectText(page, root);
          await expect(toolbar.getByRole('button', { name: 'Bold', exact: true })).toBeVisible();
        }
      });
    }
    test('block controls, delete and nested colors menu match the editor and remain actionable', async ({
      page,
    }) => {
      const block = page.locator('#one [data-id="select"] .bn-inline-content');
      await block.hover();
      const handle = page
        .locator('#one')
        .getByRole('button', { name: 'Open block menu', exact: true });
      await expect(handle).toHaveCSS('width', '24px');
      await handle.click();
      await surface(page.locator('#one .bn-drag-handle-menu'));
      const remove = page.locator('#one').getByRole('menuitem', { name: 'Delete', exact: true });
      await expect(remove.locator('svg')).toHaveCount(1);
      await expect(remove).toHaveCSS('color', 'rgb(220, 38, 38)');
      await page.locator('#one').getByRole('menuitem', { name: 'Colors', exact: false }).hover();
      await surface(page.locator('#one [data-slot="dropdown-menu-sub-content"]'));
      await page.screenshot({
        animations: 'disabled',
        path: `test-results/chrome-block-menu-${development}.png`,
      });
      await page.keyboard.press('Escape');
      await expect(page.locator('#one [data-slot="dropdown-menu-sub-content"]')).toHaveCount(0);
      await expect(remove).toBeVisible();
      await remove.click();
      await expect(page.locator('#one [data-id="select"]')).toHaveCount(0);
      await page.locator('#one .bn-editor').focus();
      await page.keyboard.press('ControlOrMeta+z');
      await expect(block).toHaveText('Select this text');
      await block.hover();
      await page.locator('#one').getByRole('button', { name: 'Add block', exact: true }).click();
      await surface(page.locator('#one .bn-suggestion-menu'));
      await expect(page.locator('#one .bn-suggestion-menu [aria-selected=true]')).toHaveCSS(
        'background-color',
        'rgb(235, 235, 235)',
      );
      await page.screenshot({
        animations: 'disabled',
        path: `test-results/chrome-slash-${development}.png`,
      });
      await page.keyboard.press('Escape');
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
      const handle = page
        .locator('#one')
        .getByRole('button', { name: 'Open block menu', exact: true });
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
    test('Chinese color submenus and shortcut badges stay readable, and selection chrome is neutral', async ({
      page,
    }) => {
      await page.evaluate(() =>
        (window as any).chromeFixture.one.setPresentation({ locale: 'zh' }),
      );
      const block = page.locator('#one [data-id="select"] .bn-inline-content');
      await block.hover();
      await page.locator('#one').getByRole('button', { name: '打开菜单', exact: true }).click();
      await page.locator('#one').getByRole('menuitem', { name: '颜色', exact: false }).hover();
      const submenu = page.locator('#one [data-slot="dropdown-menu-sub-content"]');
      await surface(submenu);
      expect((await submenu.boundingBox())!.width).toBeGreaterThanOrEqual(176);
      const row = submenu.locator('[data-test="text-color-default"]');
      await expect(row).toHaveCSS('white-space', 'nowrap');
      await page.screenshot({
        animations: 'disabled',
        path: `test-results/chrome-chinese-colors-${development}.png`,
      });
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await block.hover();
      await page.locator('#one').getByRole('button', { name: '添加块', exact: true }).click();
      const menu = page.locator('#one .bn-suggestion-menu');
      await surface(menu);
      await expect(menu.locator('[data-slot="badge"]').first()).toHaveCSS(
        'background-color',
        'rgb(247, 247, 245)',
      );
      await expect(menu.locator('[data-slot="badge"]').first()).toHaveCSS(
        'color',
        'rgb(102, 102, 102)',
      );
      await page.screenshot({
        animations: 'disabled',
        path: `test-results/chrome-chinese-slash-${development}.png`,
      });
      await page.keyboard.press('Escape');
      await selectText(page);
      expect(
        await block.evaluate((el) => getComputedStyle(el, '::selection').backgroundColor),
      ).toBe('rgb(235, 235, 235)');
      const input = page.locator('#one').getByLabel('页面标题');
      await input.focus();
      await expect(input).toHaveCSS('outline-color', 'rgb(128, 128, 128)');
    });
    test('inline mentions support keyboard insertion, atomic deletion and undo', async ({
      page,
    }) => {
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
    test('mention candidates recover from query errors and paginate', async ({ page }) => {
      await page.evaluate(async () => {
        const r = (window as any).chromeFixture.repository;
        const s = await r.readSnapshot();
        const target = s.entries.find((e: any) => e.object.id === 'target').object;
        await r.commit({
          id: crypto.randomUUID(),
          expectedVersion: s.version,
          assetIds: [],
          changes: Array.from({ length: 55 }, (_, i) => ({
            ...target,
            id: `candidate-${String(i).padStart(2, '0')}`,
            title: `Candidate ${i}`,
          })),
        });
        const query = r.queryNavigation.bind(r);
        let fail = true;
        r.queryNavigation = (q: any) => {
          if (q.mentionsOnly && fail) {
            fail = false;
            throw new Error('temporary failure');
          }
          return query(q);
        };
      });
      const block = page.locator('#one [data-id="select"] .bn-inline-content');
      await selectText(page);
      await page.keyboard.press('ArrowRight');
      await page.keyboard.type(' @');
      const menu = page.locator('#one');
      await menu.getByText('Failed to load; retry', { exact: true }).click();
      await page.keyboard.type('Candidate');
      await menu.getByText('Next page →', { exact: true }).click();
      await menu.getByText('Candidate 54', { exact: true }).click();
      await expect(block.getByRole('button', { name: 'Candidate 54', exact: true })).toBeVisible();
    });
    test('table cells accept mentions and composition Enter never selects a target', async ({
      page,
    }) => {
      await page.evaluate(async () => {
        const r = (window as any).chromeFixture.repository;
        const s = await r.readSnapshot();
        const current = s.entries.find((e: any) => e.object.id === 'main').object;
        await r.commit({
          id: crypto.randomUUID(),
          expectedVersion: s.version,
          assetIds: [],
          changes: [
            {
              ...current,
              blocks: [
                ...current.blocks,
                {
                  id: 'table',
                  type: 'table',
                  props: {},
                  children: [],
                  content: {
                    type: 'tableContent',
                    rows: [
                      {
                        cells: [
                          [{ type: 'text', text: '', styles: {} }],
                          [{ type: 'text', text: '', styles: {} }],
                        ],
                      },
                    ],
                  },
                },
              ],
            },
          ],
        });
      });
      const cell = page.locator('#one [data-id="table"] td p').first();
      await cell.click();
      await page.keyboard.type('@Explicit');
      await expect(page.locator('#one .bn-suggestion-menu')).toContainText('Explicit target');
      await cell.dispatchEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        isComposing: true,
        bubbles: true,
      });
      await expect(cell.getByRole('button', { name: 'Explicit target' })).toHaveCount(0);
      await page.keyboard.press('Enter');
      await expect(cell.getByRole('button', { name: 'Explicit target' })).toBeVisible();
      await page.evaluate(() => (window as any).chromeFixture.one.flush());
      await page.evaluate(() =>
        (window as any).chromeFixture.one.setPresentation({ readOnly: true }),
      );
      await expect(page.locator('#one .bn-editor')).toHaveAttribute('contenteditable', 'false');
    });
    test('mention labels remain stable while typing and refreshing slow metadata', async ({
      page,
    }) => {
      const label = page.locator('#one .bn-block-outer[data-id="ref"] button');
      await expect(label).toHaveText('Explicit target');
      await page.evaluate(() => {
        const fixture = (window as any).chromeFixture;
        const read = fixture.repository.readMetadata.bind(fixture.repository);
        fixture.metadataReads = 0;
        fixture.repository.readMetadata = async (...args: any[]) => {
          fixture.metadataReads++;
          await new Promise((resolve) => setTimeout(resolve, 400));
          return read(...args);
        };
        fixture.labelChanges = [];
        const root = document.querySelector('#one .bn-block-outer[data-id="ref"]')!;
        fixture.observer = new MutationObserver(() => {
          fixture.labelChanges.push(root.querySelector('button')?.textContent);
        });
        fixture.observer.observe(root, { subtree: true, childList: true, characterData: true });
      });
      await page.locator('#one [data-id="select"] .bn-inline-content').click();
      await page.keyboard.press('End');
      await page.keyboard.type(' continued editing without flickering', { delay: 80 });
      await page.evaluate(() => (window as any).chromeFixture.one.flush());
      await expect
        .poll(() => page.evaluate(() => (window as any).chromeFixture.metadataReads))
        .toBeGreaterThan(0);
      await page.waitForTimeout(600);
      await expect(label).toHaveText('Explicit target');
      const changes = await page.evaluate(() => {
        const f = (window as any).chromeFixture;
        f.observer.disconnect();
        return f.labelChanges;
      });
      expect(changes.every((title: string) => title === 'Explicit target')).toBe(true);
    });
    test('background failures preserve the title and allow explicit retry', async ({ page }) => {
      const label = page.locator('#one .bn-block-outer[data-id="ref"] button');
      await expect(label).toHaveText('Explicit target');
      await page.evaluate(async () => {
        const f = (window as any).chromeFixture;
        const r = f.repository;
        f.originalMetadataRead = r.readMetadata.bind(r);
        r.readMetadata = async () => {
          throw new Error('metadata unavailable');
        };
        const snapshot = await r.readSnapshot();
        await r.commit({
          id: crypto.randomUUID(),
          expectedVersion: snapshot.version,
          assetIds: [],
          changes: [
            {
              ...snapshot.entries.find((e: any) => e.object.id === 'target').object,
              title: 'Recovered title',
            },
          ],
        });
      });
      await expect(label).toHaveAttribute('data-refresh-error', 'true');
      await expect(label).toHaveText('Explicit target');
      await page.evaluate(() => {
        const f = (window as any).chromeFixture;
        f.repository.readMetadata = f.originalMetadataRead;
      });
      await label.click();
      await expect(label).toHaveText('Recovered title');
      await expect(label).not.toHaveAttribute('data-refresh-error');
      await expect(page.locator('#one').getByLabel('Page title')).toHaveValue('Editor chrome');
    });
    test('mention titles refresh and deleted targets keep an inert reference', async ({ page }) => {
      const label = page.locator('#one .bn-block-outer[data-id="ref"] button');
      await expect(label).toHaveText('Explicit target');
      const update = async (changes: Record<string, unknown>) =>
        page.evaluate(async (changes) => {
          const r = (window as any).chromeFixture.repository;
          const s = await r.readSnapshot();
          await r.commit({
            id: crypto.randomUUID(),
            expectedVersion: s.version,
            assetIds: [],
            changes: [
              { ...s.entries.find((e: any) => e.object.id === 'target').object, ...changes },
            ],
          });
        }, changes);
      await update({ title: 'Renamed target' });
      await expect(label).toHaveText('Renamed target');
      await update({ deleted: true });
      await expect(label).toHaveText('Deleted document');
      page.once('dialog', async (dialog) => {
        expect(dialog.message()).toBe('The source document has been deleted');
        await dialog.accept();
      });
      await label.click();
      await expect(page.locator('#one').getByLabel('Page title')).toHaveValue('Editor chrome');
    });
    test('fold chevrons and explicit references are distinct from document structure', async ({
      page,
    }) => {
      const footer = page.locator('#one .bn-block-outer[data-id="ref"]');
      await expect(page.locator('#one .tio-page-references')).toHaveCount(0);
      await expect(footer.getByRole('button', { name: 'Explicit target' })).toHaveCount(1);
      await expect(page.locator('#one .bn-block-outer[data-id="missing-ref"]')).toContainText(
        'Document unavailable',
      );
      await expect(page.locator('#one main')).not.toContainText('Tree-only child');
      await expect(footer).not.toContainText('Inbound-only page');
      const fold = page.locator(
        '#one [data-id="fold"] > .bn-block > .bn-toggle-frame > .bn-toggle-button',
      );
      await expect(fold).toHaveAttribute('aria-expanded', 'false');
      await expect(fold.locator('svg')).toBeHidden();
      expect(await fold.evaluate((el) => getComputedStyle(el, '::before').maskImage)).toContain(
        'stroke-width',
      );
      await fold.click();
      await expect(fold).toHaveAttribute('aria-expanded', 'true');
      await expect(page.locator('#one [data-id="inside"] .bn-inline-content')).toBeVisible();
      await fold.click();
      await expect(page.locator('#one [data-id="inside"] .bn-inline-content')).toBeHidden();
      const headingToggle = page.locator(
        '#one .bn-block-outer[data-id="fold-heading"] > .bn-block > .bn-toggle-frame > .bn-toggle-button',
      );
      await headingToggle.click();
      await expect(page.locator('#one [data-id="heading-child"] .bn-inline-content')).toBeVisible();
      const emptyToggle = page.locator(
        '#one .bn-block-outer[data-id="empty-fold"] > .bn-block > .bn-toggle-frame > .bn-toggle-button',
      );
      await emptyToggle.click();
      await expect(
        page.locator('#one [data-id="empty-fold"] .bn-toggle-add-block-button'),
      ).toBeVisible();
      await footer.scrollIntoViewIfNeeded();
      await page.screenshot({
        animations: 'disabled',
        path: `test-results/chrome-footer-${development}.png`,
      });
      await footer.getByRole('button', { name: 'Explicit target' }).click();
      await expect(page.locator('#one').getByLabel('Page title')).toHaveValue('Explicit target');
      await expect(footer).toHaveCount(0);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate(() => (window as any).chromeFixture.one.open({ id: 'main' }));
      await page.locator('#one [data-id="select"] .bn-inline-content').hover();
      const actions = page.locator('#one .tio-block-action');
      await expect(actions.first()).toHaveCSS('min-height', '44px');
      expect((await actions.first().boundingBox())!.x).toBeGreaterThanOrEqual(0);
      expect((await actions.last().boundingBox())!.x + 44).toBeLessThanOrEqual(390);
      await page.screenshot({
        animations: 'disabled',
        path: `test-results/chrome-mobile-${development}.png`,
      });
    });
  });
}
