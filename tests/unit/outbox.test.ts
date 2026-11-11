import { describe, expect, it } from 'vitest';
import {
  enqueueSale,
  listOutbox,
  outboxCountLabel,
  removeOutbox,
  shouldQueueSale,
} from '../../src/data/outbox';

describe('offline sales queue', () => {
  it('queues a counter sale when the network fails and not a store order', () => {
    expect(shouldQueueSale(new TypeError('Failed to fetch'), '')).toBe(true);
    expect(shouldQueueSale(new Error('Sale failed (400)'), '')).toBe(false);
    expect(shouldQueueSale(new TypeError('Failed to fetch'), 'order-1')).toBe(false);
  });

  it('keeps one queued sale until it is removed', async () => {
    await enqueueSale({
      clientSaleId: 'sale-queue-1',
      body: { total_ugx: 8000, client_sale_id: 'sale-queue-1' },
      deltas: { mint: 1 },
      createdAt: '2026-11-12T12:00:00.000Z',
      label: 'Walk-in',
    });
    const rows = await listOutbox();
    expect(rows.some((row) => row.clientSaleId === 'sale-queue-1')).toBe(true);
    expect(outboxCountLabel(1)).toBe('1 sale waiting to sync');
    await removeOutbox('sale-queue-1');
    const after = await listOutbox();
    expect(after.some((row) => row.clientSaleId === 'sale-queue-1')).toBe(false);
  });
});
