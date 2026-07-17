import { json, sendDueReminders } from './_shared/send-reminders.mjs';

/**
 * Scheduled push sender — fires Kampala quote-lab slots even when the browser is closed.
 * Runs every 5 minutes on production deploys only.
 */
export default async () => {
  const results = await sendDueReminders(new Date());
  if (results.error) return json(results, results.status || 500);
  return json(results);
};

export const config = {
  schedule: '*/5 * * * *',
};
