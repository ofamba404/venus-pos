import type { Page } from '@playwright/test';
import type { Scenario, ScenarioStep } from '../scenarios/types';
import { installMockBackend, type MockHandle } from '../../mock';

export type NextDriver = {
  mock: MockHandle;
  run: (scenario: Scenario) => Promise<void>;
};

async function addProduct(page: Page, step: Extract<ScenarioStep, { do: 'addProduct' }>) {
  await page.getByTestId(`product-${step.product}`).click();
  if (step.qty != null) {
    const n = Math.max(0, Math.round(step.qty));
    for (let i = 1; i < n; i += 1) {
      await page.getByLabel('Increase quantity').click();
    }
  }
  if (step.flavors) {
    for (const [id, count] of Object.entries(step.flavors)) {
      const times = Math.max(0, Math.round(Number(count) || 0));
      for (let i = 0; i < times; i += 1) {
        const byTestId = page.getByTestId(`config-flavor-${id}-inc`);
        if (await byTestId.count()) {
          await byTestId.click();
          continue;
        }
        await page.getByLabel(new RegExp(`More ${id.replace(/^cookie_/, '')}`, 'i')).click();
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
        const review = page.getByRole('dialog', { name: 'Review sale' });
        if (await review.count()) await review.getByTestId('cart-client').fill(step.name);
        else await page.getByTestId('cart-client').first().fill(step.name);
        return;
      }
      case 'setCredit':
        await page.getByRole('tab', { name: step.value ? 'On credit' : 'Paid' }).click();
        return;
      case 'setDelivery':
        if (step.feeUgx != null) {
          const fee = page.getByTestId('delivery-fee');
          if (await fee.count()) await fee.fill(String(step.feeUgx));
        }
        return;
      case 'charge': {
        const review = page.getByRole('dialog', { name: 'Review sale' });
        if (await review.count()) await review.getByTestId('charge').click();
        else await page.getByTestId('charge').first().click();
        return;
      }
      case 'doubleTapCharge': {
        const review = page.getByRole('dialog', { name: 'Review sale' });
        if (await review.count()) await review.getByTestId('charge').dblclick();
        else await page.getByTestId('charge').first().dblclick();
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
        await page.getByTestId('stock-set-count').fill(String(step.qty));
        await page.getByTestId('stock-set-confirm').click();
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
      case 'saleRecorded':
        await page.getByText(new RegExp(String(step.total).replace(/\B(?=(\d{3})+(?!\d))/g, ','))).first().waitFor({
          timeout: 10000,
        });
        return;
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
