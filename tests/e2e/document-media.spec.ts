import { expect, test, type Page } from '@playwright/test';

async function create(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '仅此浏览器', exact: true }).click();
  await page.getByRole('button', { name: '创建工作空间', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建工作空间', exact: true });
  await dialog.getByRole('textbox').fill('文档媒体测试');
  await dialog.getByRole('button', { name: '新建', exact: true }).click();
  await expect(page.getByLabel('页面标题')).toHaveValue('开始');
}
async function saved(page: Page) {
  await expect(page.locator('header').getByRole('button', { name: /^已保存本地/ })).toBeVisible();
}
async function testImage(page: Page) {
  return Buffer.from(
    await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 400;
      canvas.height = 1200;
      const context = canvas.getContext('2d')!;
      const gradient = context.createLinearGradient(0, 0, 0, 1200);
      gradient.addColorStop(0, '#174c68');
      gradient.addColorStop(0.5, '#92c8bd');
      gradient.addColorStop(1, '#e7b381');
      context.fillStyle = gradient;
      context.fillRect(0, 0, 400, 1200);
      return canvas.toDataURL('image/png').split(',')[1];
    }),
    'base64',
  );
}
test('preset covers and builtin icons persist and undo independently from document content', async ({
  page,
}) => {
  await create(page);
  const title = page.getByLabel('页面标题');
  await title.fill('封面和图标保留正文');
  const editor = page.locator('.bn-editor').first();
  const content = await editor.innerText();
  await title.hover();
  await page.getByRole('button', { name: '添加封面', exact: true }).click();
  await page.getByRole('button', { name: '晨曦', exact: true }).click();
  await title.hover();
  await page.getByRole('button', { name: '添加图标', exact: true }).click();
  await page.getByRole('tab', { name: '图标', exact: true }).click();
  await page.getByRole('button', { name: '火箭', exact: true }).click();
  await saved(page);
  await page.reload();
  await expect(page.locator('.tio-document-cover')).toBeVisible();
  await expect(
    page.getByRole('button', { name: '更换图标', exact: true }).locator('svg'),
  ).toBeVisible();
  await page.locator('.tio-document-cover').hover();
  await page.getByRole('button', { name: '更换封面', exact: true }).click();
  await page.getByRole('button', { name: '移除封面', exact: true }).click();
  await expect(page.locator('.tio-document-cover')).toHaveCount(0);
  await title.focus();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('.tio-document-cover')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(page.locator('.tio-document-cover')).toHaveCount(0);
  await expect(title).toHaveValue('封面和图标保留正文');
  await expect(editor).toHaveText(content, { useInnerText: true });
});
test('uploaded icons and covers reopen with their assets and cover positioning is a single undo', async ({
  page,
}) => {
  await create(page);
  const file = { name: 'cover.png', mimeType: 'image/png', buffer: await testImage(page) };
  const title = page.getByLabel('页面标题');
  await title.hover();
  await page.getByRole('button', { name: '添加图标', exact: true }).click();
  await page.getByRole('tab', { name: '上传', exact: true }).click();
  await page.getByLabel('上传图片', { exact: true }).setInputFiles(file);
  await expect(
    page.getByRole('button', { name: '更换图标', exact: true }).locator('img'),
  ).toBeVisible();
  await title.hover();
  await page.getByRole('button', { name: '添加封面', exact: true }).click();
  await page.getByRole('tab', { name: '上传', exact: true }).click();
  await page.getByLabel('上传图片', { exact: true }).setInputFiles(file);
  const cover = page.locator('.tio-document-cover');
  const image = cover.getByRole('img');
  await expect(image).toBeVisible();
  await saved(page);
  await page.reload();
  await expect(image).toBeVisible();
  await expect(page.locator('aside img').last()).toBeVisible();
  await cover.hover();
  await page.getByRole('button', { name: '重新定位', exact: true }).click();
  await page.getByRole('slider', { name: '封面位置' }).press('ArrowDown');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(image).toHaveCSS('object-position', '50% 50%');
  await cover.hover();
  await page.getByRole('button', { name: '重新定位', exact: true }).click();
  await page.getByRole('slider', { name: '封面位置' }).press('ArrowDown');
  await page.getByRole('button', { name: '保存位置', exact: true }).click();
  await expect(image).toHaveCSS('object-position', '50% 55%');
  await title.focus();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(image).toHaveCSS('object-position', '50% 50%');
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(image).toHaveCSS('object-position', '50% 55%');
  await saved(page);
  await page.reload();
  await expect(image).toHaveCSS('object-position', '50% 55%');
});

test('invalid uploads and failed links preserve the cover until a valid image is chosen', async ({
  page,
}) => {
  await create(page);
  const title = page.getByLabel('页面标题');
  await title.hover();
  await page.getByRole('button', { name: '添加封面', exact: true }).click();
  await page.getByRole('button', { name: '晨曦', exact: true }).click();
  const cover = page.locator('.tio-document-cover');
  const background = await cover.evaluate((element) => (element as HTMLElement).style.background);
  await cover.hover();
  await page.getByRole('button', { name: '更换封面', exact: true }).click();
  await page.getByRole('tab', { name: '上传', exact: true }).click();
  const upload = page.getByLabel('上传图片', { exact: true });
  await upload.setInputFiles({
    name: 'not-image.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('text'),
  });
  await expect(page.getByRole('alert')).toContainText('请选择 PNG');
  await upload.setInputFiles({
    name: 'broken.png',
    mimeType: 'image/png',
    buffer: Buffer.from('broken'),
  });
  await expect(page.getByRole('alert')).toContainText('无法加载图片');
  await upload.setInputFiles({
    name: 'large.png',
    mimeType: 'image/png',
    buffer: Buffer.alloc(10 * 1024 * 1024 + 1),
  });
  await expect(page.getByRole('alert')).toContainText('不能超过 10 MB');
  await page.getByRole('tab', { name: '链接', exact: true }).click();
  await page.getByLabel('图片链接').fill('javascript:alert(1)');
  await page.getByRole('button', { name: '预览', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('HTTP');
  await page.route('https://media.example.test/broken.png', (route) =>
    route.fulfill({ status: 404, body: 'missing' }),
  );
  await page.getByLabel('图片链接').fill('https://media.example.test/broken.png');
  await page.getByRole('button', { name: '预览', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('无法加载图片');
  expect(await cover.evaluate((element) => (element as HTMLElement).style.background)).toBe(
    background,
  );
  const bytes = await testImage(page);
  await page.route('https://media.example.test/cover.png', (route) =>
    route.fulfill({ contentType: 'image/png', body: bytes }),
  );
  await page.getByLabel('图片链接').fill('https://media.example.test/cover.png');
  await page.getByRole('button', { name: '预览', exact: true }).click();
  await expect(page.getByRole('img', { name: '预览', exact: true })).toBeVisible();
  expect(await cover.evaluate((element) => (element as HTMLElement).style.background)).toBe(
    background,
  );
  await page.getByRole('button', { name: '使用图片', exact: true }).click();
  await expect(cover.getByRole('img')).toHaveAttribute(
    'src',
    'https://media.example.test/cover.png',
  );
});
