import { json, sendDueReminders } from './_shared/send-reminders.mjs';

/** Manual / debug tick — POST or GET /api/push/tick */
export default async () => {
  const results = await sendDueReminders(new Date());
  if (results.error) return json(results, results.status || 500);
  return json(results);
};

export const config = {
  path: '/api/push/tick',
  method: ['GET', 'POST'],
};
