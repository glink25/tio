import { expect, test } from '@playwright/test';

test('static code modes, HTML sandbox and prerendered Mermaid images', async ({ page }) => {
  await page.goto('/');
  for (const language of ['html', 'mermaid']) {
    for (const mode of ['code', 'preview', 'split']) {
      const block = page.locator('#' + language + '-' + mode);
      await expect(block.getByRole('radio', { name: mode, exact: false })).toBeChecked();
      if (mode === 'preview') await expect(block.locator('.tio-code-source')).toBeHidden();
      else await expect(block.locator('.tio-code-source')).toBeVisible();
      if (mode === 'code') await expect(block.locator('.tio-code-preview')).toBeHidden();
      else if (language === 'html')
        await expect(block.frameLocator('iframe').getByRole('heading')).toHaveText('HTML preview');
      else await expect(block.locator('.tio-code-preview img')).toBeVisible();
    }
    const block = page.locator('#' + language + '-code');
    await block.getByRole('radio', { name: 'Split', exact: true }).check();
    await expect(block.locator('.tio-code-source')).toBeVisible();
    if (language === 'html')
      await expect(block.locator('iframe')).toHaveAttribute('sandbox', 'allow-scripts');
    else {
      await block.locator('img').scrollIntoViewIfNeeded();
      await expect
        .poll(() =>
          block
            .locator('img')
            .evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0),
        )
        .toBe(true);
    }
    await block.getByRole('radio', { name: 'Preview', exact: true }).check();
    await expect(block.locator('.tio-code-source')).toBeHidden();
    await block.getByRole('radio', { name: 'Code', exact: true }).check();
    await expect(block.locator('.tio-code-preview')).toBeHidden();
  }
  expect(await page.locator('body').getAttribute('data-escape')).toBeNull();
  expect(await page.locator('#highlight code').textContent()).toBe('  const message = "hello";\n');
  const token = page.locator('#highlight .line span').first();
  const light = await token.evaluate((node) => getComputedStyle(node).color);
  await page.emulateMedia({ colorScheme: 'dark' });
  expect(await token.evaluate((node) => getComputedStyle(node).color)).not.toBe(light);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});

test('Mermaid page requests no JavaScript and works without JavaScript including mode switching', async ({
  page,
  browser,
}) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.goto('/lazy');
  await page.getByRole('radio', { name: 'Preview', exact: true }).check();
  await expect(page.locator('#lazy-mermaid img')).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(requests.filter((url) => url.endsWith('.js'))).toEqual([]);
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const staticPage = await context.newPage();
    await staticPage.goto(page.url().replace(/\/lazy$/, '/'));
    await expect(staticPage.locator('#mermaid-preview .tio-code-source')).toBeHidden();
    await expect(staticPage.locator('#mermaid-preview img')).toBeVisible();
    await staticPage
      .locator('#mermaid-preview')
      .getByRole('radio', { name: 'Split', exact: true })
      .check();
    await expect(staticPage.locator('#mermaid-preview .tio-code-source')).toBeVisible();
    await expect(staticPage.locator('#mermaid-preview img')).toBeVisible();
    await expect(staticPage.locator('#highlight')).toHaveClass(/shiki/);
  } finally {
    await context.close();
  }
});
