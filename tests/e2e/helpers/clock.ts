import type { Page } from '@playwright/test';
import { toWheelParts } from '../../../src/domain/clock';

/** Picks "HH:mm" (24-hour) on our time picker wheels that are already open, then taps Set. */
export async function pickOnWheels(page: Page, value: string) {
  const { hour, minute, pm } = toWheelParts(value);
  await page.getByTestId(`clock-hour-${hour}`).click();
  const minuteRow = page.getByTestId(`clock-minute-${minute}`);
  if (await minuteRow.count()) await minuteRow.click();
  await page.getByTestId(`clock-ampm-${pm ? 'pm' : 'am'}`).click();
  await page.getByTestId('clock-done').click();
}

/** Sets a time chip ("HH:mm", or "" to clear) through the picker sheet. */
export async function setClock(page: Page, testId: string, value: string) {
  await page.getByTestId(testId).click();
  const sheet = page.getByTestId('clock-sheet');
  await sheet.waitFor();
  if (value === '') {
    await page.getByTestId('clock-clear').click();
  } else {
    await pickOnWheels(page, value);
  }
  await sheet.waitFor({ state: 'hidden' });
}
