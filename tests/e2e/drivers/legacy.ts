import type { Page } from '@playwright/test';
import type { Scenario } from '../scenarios/types';

/**
 * Legacy UI driver — selectors TBD from `legacy/js` pages.
 * Recording goldens (`RECORD=1`) uses this path once the static server serves v1 at :4173.
 */
export async function createLegacyDriver(page: Page) {
  return {
    async run(_scenario: Scenario) {
      throw new Error('legacy driver not implemented yet — serve v1 and map intents to pages/*.html');
    },
  };
}
