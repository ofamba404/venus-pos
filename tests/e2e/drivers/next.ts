import type { Page } from '@playwright/test';
import type { Scenario, ScenarioStep } from '../scenarios/types';
import { installMockBackend, type MockHandle } from '../../mock';

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

async function runStep(page: Page, step: ScenarioStep) {
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
        if (step.feeUgx != null) {
          await scope.getByTestId('delivery-fee').fill(String(step.feeUgx));
        }
        return;
      }
      case 'charge': {
        const scope = await saleScope(page);
        await scope.getByTestId('charge').click();
        return;
      }
      case 'doubleTapCharge': {
        const scope = await saleScope(page);
        await scope.getByTestId('charge').dblclick();
        return;
      }
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
      await page.goto('/next/sell');
      await page.getByRole('heading', { name: /packs|sell|today/i }).first().waitFor({ timeout: 15000 }).catch(() => {});
      for (const step of scenario.steps) {
        await runStep(page, step);
      }
    },
  };
}
