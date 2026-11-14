import { expect, test } from '@playwright/test';
import { VAPID_PUBLIC_KEY } from '../../src/data/env';
import { createNextDriver } from './drivers/next';

/**
 * Settings, Test notifications. Chromium cannot reach a real push service here, so the
 * worker registration and subscription are faked in the page and /api/push/test is mocked.
 * The server half (VAPID, encryption, delivery) is proven in tests/unit/push-functions.test.ts.
 */
test('Test notifications walks the path and shows each step', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await createNextDriver(page, { role: 'pos_admin' });
  await page.addInitScript((vapid) => {
    const padded = vapid + '='.repeat((4 - (vapid.length % 4)) % 4);
    const bytes = Uint8Array.from(atob(padded.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
    const sub = { endpoint: 'https://push.example/phone', options: { applicationServerKey: bytes.buffer } };
    const shown: string[] = [];
    (window as unknown as { __shown: string[] }).__shown = shown;
    const reg = {
      active: {},
      scope: `${location.origin}/next/`,
      showNotification: async (title: string) => void shown.push(title),
      pushManager: { getSubscription: async () => sub },
    };
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { getRegistration: async () => reg, register: async () => reg },
      configurable: true,
    });
    (window as unknown as { PushManager: unknown }).PushManager = class {};
    Object.defineProperty(Notification, 'permission', { get: () => 'granted', configurable: true });
  }, VAPID_PUBLIC_KEY);
  let body = '';
  await page.route('**/api/push/test', async (route) => {
    body = route.request().postData() || '';
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"step":"sent","pushService":"fcm.googleapis.com"}' });
  });
  await page.goto('/next/settings');
  await page.getByTestId('test-notifications').click();
  const card = page.getByTestId('notification-check');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Browser');
  await expect(card).toContainText('Permission');
  await expect(card).toContainText('Worker');
  await expect(card).toContainText('Subscription');
  await expect(card).toContainText('Push from server');
  await expect(card.locator('[data-ok="false"]')).toHaveCount(0);
  expect(JSON.parse(body)).toEqual({ endpoint: 'https://push.example/phone' });
  expect(await page.evaluate(() => (window as unknown as { __shown: string[] }).__shown)).toEqual(['Venus test (on this phone)']);
  await page.screenshot({ path: 'test-results/notification-check.png' });
});
