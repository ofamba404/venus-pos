import type { Page } from '@playwright/test';
import type { Scenario, ScenarioStep } from '../scenarios/types';
import { installMockBackend, type MockHandle } from '../../mock';

export type LegacyDriver = {
  mock: MockHandle;
  run: (scenario: Scenario) => Promise<void>;
};

async function addProduct(page: Page, step: Extract<ScenarioStep, { do: 'addProduct' }>) {
  const addAnother = page.locator('#addItemBtn');
  if (await addAnother.isVisible().catch(() => false)) {
    await addAnother.click();
    await page.locator('#orderModal').locator(`[data-product="${step.product}"]`).click({ force: true });
  } else {
    await page.locator(`[data-product="${step.product}"]:visible`).first().click();
  }
  if (step.qty !== undefined) {
    const n = Math.max(0, Math.round(step.qty));
    for (let i = 0; i < n; i += 1) {
      await page.locator('[data-pick="qty"][data-pdir="1"]').click();
    }
  }
  if (step.flavors) {
    for (const [id, count] of Object.entries(step.flavors)) {
      const times = Math.max(0, Math.round(Number(count) || 0));
      for (let i = 0; i < times; i += 1) {
        await page.locator(`[data-pick="${id}"][data-pdir="1"]`).click();
      }
    }
  }
  if (step.unitPrice !== undefined) {
    const price = page.locator('#wholesaleUnitPrice, input[name="unitPrice"], [data-unit-price]').first();
    if (await price.count()) await price.fill(String(step.unitPrice));
  }
  const add = page.locator('#addToOrderBtn');
  await add.waitFor({ state: 'visible', timeout: 8000 });
  await add.click();
  await page.locator('#cartClientInput').waitFor({ state: 'visible', timeout: 8000 });
}

async function runStep(page: Page, step: ScenarioStep, mock: MockHandle) {
  if ('do' in step) {
    switch (step.do) {
      case 'addProduct':
        await addProduct(page, step);
        return;
      case 'setClient': {
        const input = page.locator('#cartClientInput');
        await input.click();
        await input.fill(step.name);
        const option = page.locator('#cartClientDropdown [role="option"]').filter({ hasText: step.name }).first();
        const shown = await option
          .waitFor({ state: 'visible', timeout: 1500 })
          .then(() => true)
          .catch(() => false);
        if (shown) await option.click();
        return;
      }
      case 'setCredit': {
        const toggle = page.locator('#creditToggle');
        const on = (await toggle.getAttribute('aria-checked')) === 'true';
        if (on !== step.value) await toggle.click();
        return;
      }
      case 'charge': {
        const done = await page
          .locator('#orderModalTitle')
          .filter({ hasText: /Order recorded|Recorded on credit/ })
          .isVisible()
          .catch(() => false);
        if (done) return;
        await page.locator('#checkoutBtn').click();
        return;
      }
      case 'doubleTapCharge':
        await page.locator('#checkoutBtn').dblclick();
        return;
      case 'go':
        await page.goto(step.path.startsWith('/') ? step.path : `/${step.path}`);
        return;
      default:
        throw new Error(`legacy driver has no step yet: ${step.do}`);
    }
  }

  if ('expect' in step) {
    switch (step.expect) {
      case 'saleRecorded': {
        await page
          .locator('#orderModalTitle, .checkout-success-total')
          .filter({ hasText: /Order recorded|Recorded on credit|UGX/ })
          .first()
          .waitFor({ timeout: 15000 });
        const formatted = String(step.total).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        await page.getByText(new RegExp(formatted)).first().waitFor({ timeout: 5000 });
        return;
      }
      case 'noWrites': {
        const bad = mock.writes.filter((w) => {
          if (w.method === 'POST' && w.url.includes('/rest/v1/sales')) return true;
          return (w.body as { op?: string } | null)?.op === 'delta';
        });
        if (bad.length) throw new Error(`expected no sale or stock writes, saw ${bad.length}`);
        return;
      }
      case 'toast':
        await page.getByText(new RegExp(step.message, 'i')).first().waitFor({ timeout: 8000 });
        return;
      default:
        throw new Error(`legacy driver has no expect yet: ${step.expect}`);
    }
  }
}

export async function createLegacyDriver(
  page: Page,
  opts: { role?: 'pos_admin' | 'pos_staff'; seed?: 'default' | 'empty' } = {},
): Promise<LegacyDriver> {
  const mock = await installMockBackend(page, {
    role: opts.role || 'pos_staff',
    seed: opts.seed || 'default',
  });

  return {
    mock,
    async run(scenario) {
      await page.goto('/');
      await page.locator('[data-product]').first().waitFor({ timeout: 20000 });
      for (const step of scenario.steps) {
        await runStep(page, step, mock);
      }
    },
  };
}
