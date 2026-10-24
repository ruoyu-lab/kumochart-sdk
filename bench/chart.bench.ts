import { expect, test } from '@playwright/test';

interface BenchResult {
  group: string;
  name: string;
  value: number;
  unit: string;
}

const BARS = Number(process.env.BENCH_BARS ?? 500_000);

test(`chart with ${BARS} one-minute bars`, async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/bench.html');
  await page.waitForFunction(() => 'bench' in window);
  const results = await page.evaluate(
    (count) =>
      (window as unknown as { bench: { run(count: number): BenchResult[] } }).bench.run(count),
    BARS
  );

  const rows = results.map(
    (result) =>
      `${result.group.padEnd(16)}${result.name.padEnd(46)}${String(result.value).padStart(12)} ${result.unit}`
  );
  process.stdout.write(`\n${rows.join('\n')}\n`);
  expect(errors).toEqual([]);
});
