import { expect, test, type Page } from '@playwright/test';

const errors = new WeakMap<Page, string[]>();

test.beforeEach(({ page }) => {
  const collected: string[] = [];
  errors.set(page, collected);
  page.on('pageerror', (error) => collected.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      collected.push(message.text());
    }
  });
});

test.afterEach(({ page }) => {
  expect(errors.get(page)).toEqual([]);
});

/** Where the page is scrolled in each frame for a while after `act`. */
async function scrolledAfter(page: Page, act: () => Promise<void>): Promise<number[]> {
  const sampled = page.evaluate(
    () =>
      new Promise<number[]>((resolve) => {
        const seen: number[] = [];
        const start = performance.now();
        const sample = () => {
          seen.push(window.scrollY);

          if (performance.now() - start < 1200) {
            requestAnimationFrame(sample);
          } else {
            resolve(seen);
          }
        };
        requestAnimationFrame(sample);
      })
  );
  await act();
  return sampled;
}

test('the links of the contents glide the page to their heading', async ({ page }) => {
  await page.goto('/zh-CN/guide/');
  const link = page.locator('.toc').getByRole('link', { name: '代码块' });
  const jumped = await scrolledAfter(page, () => link.click());
  const heading = page.getByRole('heading', { name: '代码块' });

  expect(new Set(jumped).size).toBeGreaterThan(5);
  expect(await heading.evaluate((element) => element.getBoundingClientRect().top)).toBeCloseTo(
    80,
    0
  );
  await expect(page.locator('.toc [aria-current="true"]')).toHaveText('代码块');
});

test('the sidebar, the pager and the contents lead through the pages', async ({ page }) => {
  await page.goto('/zh-CN/');
  await page.locator('.sidebar').getByRole('link', { name: '写法示例' }).click();
  await expect(page).toHaveURL('/zh-CN/guide/');
  await expect(page.locator('h1')).toHaveText('写法示例');
  await expect(page.locator('.sidebar [aria-current="page"]')).toHaveText('写法示例');

  await page.locator('.toc').getByRole('link', { name: '代码块' }).click();
  await expect(page).toHaveURL(/#%E4%BB%A3%E7%A0%81%E5%9D%97$/);
  await expect(page.locator('.toc [aria-current="true"]')).toHaveText('代码块');

  await page.locator('.pager-next').click();
  await expect(page).toHaveURL('/zh-CN/live/');
  await page.locator('.pager-previous').click();
  await expect(page).toHaveURL('/zh-CN/guide/');
});

test('the language switch keeps the page, and the root opens the language last read', async ({
  page
}) => {
  await page.goto('/zh-CN/live/');
  await page.getByRole('button', { name: '语言' }).click();
  await page.getByRole('menuitemradio', { name: 'English' }).click();
  await expect(page).toHaveURL('/en/live/');
  await expect(page.locator('.notice')).toHaveText(
    'This page has not been translated yet; it is shown in Chinese.'
  );
  await expect(page.locator('.sidebar [aria-current="page"]')).toHaveText('Live charts');

  await page.goto('/en/guide/');
  await expect(page.locator('.notice')).toHaveCount(0);
  await expect(page.locator('h1')).toHaveText('Writing pages');

  await page.goto('/');
  await expect(page).toHaveURL('/en/');
  await page.getByRole('button', { name: 'Language' }).click();
  await page.getByRole('menuitemradio', { name: '日本語' }).click();
  await expect(page).toHaveURL('/ja/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
  await page.goto('/');
  await expect(page).toHaveURL('/ja/');
});

test("the root opens the first of the reader's languages the site has", async ({ browser }) => {
  const context = await browser.newContext({ locale: 'ko-KR' });
  const page = await context.newPage();
  await page.goto('/');
  await expect(page).toHaveURL('/ko/');
  await context.close();
});

test('the search finds Chinese words and API symbols, and opens a result', async ({ page }) => {
  await page.goto('/zh-CN/guide/');
  await page.keyboard.press('ControlOrMeta+k');
  const input = page.getByRole('searchbox', { name: '搜索文档' });
  await expect(input).toBeFocused();

  await input.fill('均线');
  const results = page.locator('[data-search-results] a');
  await expect(results.first()).toContainText('写法示例');
  await expect(results.first().locator('mark').first()).toHaveText('均线');

  await input.fill('setTimeframe');
  await expect(results.first()).toHaveAttribute('href', '/zh-CN/api/core/#DataApi.setTimeframe');
  await input.press('Enter');
  await expect(page).toHaveURL('/zh-CN/api/core/#DataApi.setTimeframe');
  await expect(page.locator('[id="DataApi.setTimeframe"]')).toBeInViewport();

  await page.getByRole('button', { name: '搜索' }).click();
  await page.getByRole('searchbox').fill('没有这样的内容');
  await expect(page.locator('.search-status')).toHaveText('没有找到相关内容');
  await page.keyboard.press('Escape');
  await expect(page.locator('dialog.search')).not.toBeVisible();
});

/** How many colors a frame's chart has painted: a blank canvas has one. */
async function paintedColors(page: Page, url: RegExp): Promise<number> {
  const frame = page.frames().find((item) => url.test(item.url()));

  if (!frame) {
    return 0;
  }

  return frame.evaluate(() => {
    const colors = new Set<number>();

    for (const canvas of document.querySelectorAll<HTMLCanvasElement>('#chart canvas')) {
      const context = canvas.getContext('2d');

      if (!context || canvas.width === 0 || canvas.height === 0) {
        continue;
      }

      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);

      for (let index = 0; index < data.length; index += 4 * 7) {
        colors.add(
          ((data[index] ?? 0) << 16) | ((data[index + 1] ?? 0) << 8) | (data[index + 2] ?? 0)
        );
      }
    }

    return colors.size;
  });
}

test('live examples draw real charts from their code', async ({ page }) => {
  await page.goto('/zh-CN/live/');
  const frames = page.locator('iframe.live-frame');
  await expect(frames).toHaveCount(2);

  await frames.nth(0).scrollIntoViewIfNeeded();
  await expect
    .poll(() => paintedColors(page, /\/examples\/zh-CN\/live\/1\.html$/), { timeout: 15_000 })
    .toBeGreaterThan(20);

  await frames.nth(1).scrollIntoViewIfNeeded();
  await expect
    .poll(() => paintedColors(page, /\/examples\/zh-CN\/live\/2\.html$/), { timeout: 15_000 })
    .toBeGreaterThan(20);

  // The second example starts with its code folded.
  const second = page.locator('.live-code').nth(1);
  await expect(second.locator('pre')).not.toBeVisible();
  await second.locator('summary').click();
  await expect(second.locator('pre')).toBeVisible();

  for (const frame of page.frames().filter((item) => item !== page.mainFrame())) {
    await expect(frame.locator('.frame-error')).toHaveCount(0);
  }
});

test('Vue and React examples mount their component', async ({ page }) => {
  await page.goto('/zh-CN/frameworks/');
  const frames = page.locator('iframe.live-frame');

  for (const [index, url] of [/frameworks\/1\.html$/, /frameworks\/2\.html$/].entries()) {
    await frames.nth(index).scrollIntoViewIfNeeded();
    await expect.poll(() => paintedColors(page, url), { timeout: 15_000 }).toBeGreaterThan(20);
  }
});

test('code blocks copy their code', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/zh-CN/guide/');
  const block = page.locator('.code-block', { hasText: 'npm install' });
  await block.hover();
  await block.getByRole('button', { name: '复制' }).click();
  await expect(block.getByRole('button')).toHaveText('已复制');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'npm install @kumochart-sdk/core'
  );
});

test('the theme follows the system until one is chosen, live examples with it', async ({
  page
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/zh-CN/live/');
  const root = page.locator('html');
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(8, 8, 8)');

  const element = page.locator('iframe.live-frame').first();
  const frame = element.contentFrame();
  await element.scrollIntoViewIfNeeded();
  await expect(frame.locator('html')).toHaveAttribute('data-theme', 'dark');

  await page.getByRole('button', { name: '外观' }).click();
  await page.getByRole('menuitemradio', { name: '浅色' }).click();
  await expect(root).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(frame.locator('html')).toHaveAttribute('data-theme', 'light');

  await page.reload();
  await expect(root).toHaveAttribute('data-theme', 'light');

  await page.getByRole('button', { name: '外观' }).click();
  await page.getByRole('menuitemradio', { name: '跟随系统' }).click();
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(root).toHaveAttribute('data-theme', 'light');
});

test('the API reference has anchors that guides and its own types link to', async ({ page }) => {
  await page.goto('/zh-CN/guide/');
  await page.getByRole('link', { name: 'createChart()' }).click();
  await expect(page).toHaveURL('/zh-CN/api/core/#createChart');
  await expect(page.locator('[id="createChart"]')).toBeInViewport();

  await page
    .locator('[id="createChart"] + .code-block a, [id="createChart"] ~ pre a')
    .first()
    .click();
  await expect(page).toHaveURL('/zh-CN/api/core/#ChartModule');
  await expect(page.locator('[id="ChartModule"]')).toBeInViewport();
});

test('the page of a missing address offers the way home', async ({ page }) => {
  await page.goto('/404.html');
  await expect(page.locator('h1:visible')).toHaveText('找不到这个页面');
  await expect(page.getByRole('link', { name: '回到首页' })).toHaveAttribute('href', '/zh-CN/');
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

  test('the navigation is a drawer and nothing scrolls sideways', async ({ page }) => {
    for (const url of ['/zh-CN/guide/', '/zh-CN/live/', '/en/api/core/', '/zh-CN/frameworks/']) {
      await page.goto(url);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth
      );
      expect(overflow, url).toBeLessThanOrEqual(0);
    }

    await page.goto('/zh-CN/guide/');
    const sidebar = page.locator('#sidebar');
    await expect(sidebar).not.toBeInViewport();

    await page.getByRole('button', { name: '打开目录' }).click();
    await expect(sidebar).toBeInViewport();
    await sidebar.getByRole('link', { name: 'Vue 和 React' }).click();
    await expect(page).toHaveURL('/zh-CN/frameworks/');
    await expect(page.locator('#sidebar')).not.toBeInViewport();

    await page.getByRole('button', { name: '打开目录' }).click();
    await page.locator('.sidebar-backdrop').click({ position: { x: 360, y: 400 } });
    await expect(page.locator('#sidebar')).not.toBeInViewport();
  });
});
