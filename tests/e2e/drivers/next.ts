import type { Page } from '@playwright/test';
import type { Scenario, ScenarioStep } from '../scenarios/types';
import { installMockBackend, type MockHandle } from '../../mock';
import { PRODUCTS } from '../../../src/domain/catalog';

export type NextDriver = {
  mock: MockHandle;
  run: (scenario: Scenario) => Promise<void>;
};

async function saleScope(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Review sale' });
  const opened = await dialog
    .waitFor({ state: 'visible', timeout: 4000 })
    .then(() => true)
    .catch(() => false);
  return opened ? dialog : page;
}

async function addProduct(page: Page, step: Extract<ScenarioStep, { do: 'addProduct' }>) {
  const review = page.getByRole('dialog', { name: 'Review sale' });
  if (await review.isVisible().catch(() => false)) {
    await review.getByRole('button', { name: 'Close' }).click();
    await review.waitFor({ state: 'hidden', timeout: 5000 });
  }
  await page.getByTestId(`product-${step.product}`).click();
  if (step.qty != null) {
    const n = Math.max(0, Math.round(step.qty));
    for (let i = 1; i < n; i += 1) {
      await page.getByTestId('config-qty-inc').click();
    }
  }
  if (step.flavors) {
    for (const [id, count] of Object.entries(step.flavors)) {
      const times = Math.max(0, Math.round(Number(count) || 0));
      for (let i = 0; i < times; i += 1) {
        await page.getByTestId(`config-flavor-${id}-inc`).click();
      }
    }
  }
  if (step.unitPrice != null) {
    await page.getByLabel(/unit price/i).fill(String(step.unitPrice));
  }
  await page.getByTestId('config-add').click();
}

function productLabel(id: string | undefined) {
  if (!id) return '';
  return PRODUCTS.find((p) => p.id === id)?.name || id;
}

async function saleAlreadyRecorded(page: Page) {
  return page
    .getByText(/Sale recorded|Recorded on credit/)
    .first()
    .isVisible()
    .catch(() => false);
}

async function runStep(page: Page, step: ScenarioStep, mock: MockHandle) {
  if ('do' in step) {
    switch (step.do) {
      case 'addProduct':
        await addProduct(page, step);
        return;
      case 'setClient': {
        const scope = await saleScope(page);
        await scope.getByTestId('cart-client').fill(step.name);
        return;
      }
      case 'setCredit': {
        const scope = await saleScope(page);
        await scope.getByRole('tab', { name: step.value ? 'On credit' : 'Paid' }).click();
        return;
      }
      case 'setDelivery': {
        const scope = await saleScope(page);
        await scope.getByRole('tab', { name: 'Delivery' }).click();
        if (step.destText) {
          await scope.getByTestId('place-input').fill(step.destText);
          const opt = scope.getByTestId('place-option').first();
          const shown = await opt
            .waitFor({ state: 'visible', timeout: 2500 })
            .then(() => true)
            .catch(() => false);
          if (shown) await opt.click();
        }
        if (step.feeUgx != null && step.feeEdited) {
          await scope.getByTestId('delivery-fee').fill(String(step.feeUgx));
        }
        if (step.phone) await scope.getByTestId('delivery-phone').fill(step.phone);
        if (step.deliverAt) await scope.getByTestId('delivery-at').fill(step.deliverAt);
        return;
      }
      case 'editLine': {
        const scope = await saleScope(page);
        await scope.getByRole('button', { name: new RegExp(`Edit ${productLabel(step.product)}`, 'i') }).click();
        const decs = page.locator('[data-testid^="config-flavor-"][data-testid$="-dec"]');
        const count = await decs.count();
        for (let i = 0; i < count; i += 1) {
          const btn = decs.nth(i);
          for (let n = 0; n < 8; n += 1) {
            if (!(await btn.isEnabled())) break;
            await btn.click();
          }
        }
        if (step.flavors) {
          for (const [id, times] of Object.entries(step.flavors)) {
            const n = Math.max(0, Math.round(Number(times) || 0));
            for (let i = 0; i < n; i += 1) await page.getByTestId(`config-flavor-${id}-inc`).click();
          }
        }
        await page.getByTestId('config-add').click();
        return;
      }
      case 'removeLine': {
        const scope = await saleScope(page);
        const label = productLabel(step.product);
        await scope.getByRole('button', { name: new RegExp(`Remove ${label}`, 'i') }).click();
        return;
      }
      case 'undo':
        await page.getByRole('status').getByRole('button', { name: 'Undo' }).click();
        return;
      case 'confirmStackedDebt': {
        const scope = await saleScope(page);
        await scope.getByTestId('charge').click();
        const debt = page.getByRole('dialog', { name: /already owes/i });
        await debt.waitFor({ state: 'visible', timeout: 8000 });
        await debt
          .getByRole('button', { name: step.accept ? /record another credit/i : /not now/i })
          .click();
        await debt.waitFor({ state: 'hidden', timeout: 8000 });
        return;
      }
      case 'charge': {
        if (await saleAlreadyRecorded(page)) return;
        const scope = await saleScope(page);
        await scope.getByTestId('charge').click();
        return;
      }
      case 'chargeRetry': {
        const scope = await saleScope(page);
        await scope.getByTestId('charge').click();
        return;
      }
      case 'doubleTapCharge': {
        const scope = await saleScope(page);
        await scope.getByTestId('charge').dblclick();
        return;
      }
      case 'loadStoreOrder': {
        await page.goto('/next/orders');
        await page.getByTestId(`load-order-${step.id}`).click();
        await page.waitForURL(/\/next\/sell/, { timeout: 10000 });
        return;
      }
      case 'confirmStoreOrder':
        await page.getByTestId('confirm-store-order').click();
        return;
      case 'cancelStoreOrder':
        await page.goto('/next/orders');
        await page.getByTestId(`cancel-order-${step.id}`).click();
        return;
      case 'dismissStoreOrder':
        await page.goto('/next/orders');
        await page.getByRole('tab', { name: 'Closed' }).click();
        await page.getByTestId(`dismiss-order-${step.id}`).click();
        return;
      case 'parkCounterCart': {
        const scope = await saleScope(page);
        await scope.getByTestId('hold-sale').click();
        return;
      }
      case 'restoreCounterCart':
        await page.getByTestId('held-sales').getByRole('button').first().click();
        return;
      case 'adjustStock':
        await page.goto(`/next/stock`);
        if (step.delta > 0) {
          for (let i = 0; i < step.delta; i += 1) {
            await page.getByTestId(`stock-${step.categoryId}-inc`).click();
          }
        } else {
          for (let i = 0; i < Math.abs(step.delta); i += 1) {
            await page.getByTestId(`stock-${step.categoryId}-dec`).click();
          }
        }
        return;
      case 'setStockCount':
        await page.goto(`/next/stock`);
        await page.getByTestId(`stock-${step.categoryId}-qty`).click();
        const countInput = page.getByTestId('stock-set-count');
        await countInput.waitFor({ state: 'visible' });
        await countInput.fill(String(step.qty));
        await page.getByTestId('stock-set-confirm').click();
        await page.getByRole('dialog').waitFor({ state: 'hidden', timeout: 8000 });
        return;
      case 'go':
        await page.goto(`/next${step.path.startsWith('/') ? step.path : `/${step.path}`}`);
        return;
      default:
        // Intent reserved for later drivers — no-op for now.
        return;
    }
  }

  if ('expect' in step) {
    switch (step.expect) {
      case 'saleRecorded': {
        await page.getByText(/Sale recorded|Recorded on credit/).first().waitFor({ timeout: 10000 });
        const formatted = String(step.total).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        await page.getByText(new RegExp(formatted)).first().waitFor({ timeout: 5000 });
        return;
      }
      case 'stock':
        await page.goto('/next/stock');
        await page.getByTestId(`stock-${step.categoryId}-qty`).filter({ hasText: String(step.qty) }).waitFor();
        return;
      case 'toast':
        await page.getByRole('status').filter({ hasText: new RegExp(step.message, 'i') }).waitFor({
          timeout: 8000,
        });
        return;
      case 'noWrites': {
        const bad = mock.writes.filter((w) => {
          if (w.method === 'POST' && w.url.includes('/rest/v1/sales')) return true;
          return (w.body as { op?: string } | null)?.op === 'delta';
        });
        if (bad.length) throw new Error(`expected no sale or stock writes, saw ${bad.length}`);
        return;
      }
      case 'display': {
        if (step.values.cartLines != null) {
          const n = Number(step.values.cartLines);
          const lines = page.locator('[data-desktop-cart]').getByRole('button', { name: /^Remove / });
          const deadline = Date.now() + 8000;
          let count = await lines.count();
          while (count !== n && Date.now() < deadline) {
            await page.waitForTimeout(200);
            count = await lines.count();
          }
          if (count !== n) throw new Error(`expected ${n} cart lines, saw ${count}`);
        }
        return;
      }
      default:
        return;
    }
  }
}

export async function createNextDriver(page: Page, opts: { role?: 'pos_admin' | 'pos_staff'; seed?: 'default' | 'empty' } = {}): Promise<NextDriver> {
  const mock = await installMockBackend(page, {
    role: opts.role || 'pos_staff',
    seed: opts.seed || 'default',
  });

  return {
    mock,
    async run(scenario) {
      if (scenario.steps.some((step) => 'do' in step && step.do === 'chargeRetry')) {
        mock.setFailure({ method: 'POST', table: 'sales', status: 500, times: 1 });
      }
      const first = scenario.steps[0];
      if (!first || !('do' in first) || first.do !== 'go') {
        await page.goto('/next/sell');
        await page.getByRole('heading', { name: /packs|sell|today/i }).first().waitFor({ timeout: 15000 }).catch(() => {});
      }
      for (const step of scenario.steps) {
        await runStep(page, step, mock);
      }
    },
  };
}
