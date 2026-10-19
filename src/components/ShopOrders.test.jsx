import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConfirmProvider } from './ConfirmDialog';
import { ShopOrderScreen, ShopOrdersScreen } from './ShopOrders';
import { findOrder, placeOrder } from '../lib/shopOrders';

const { fetchAllServerOrders, fetchServerOrderById, cancelServerOrder } = vi.hoisted(() => ({
  fetchAllServerOrders: vi.fn(),
  fetchServerOrderById: vi.fn(),
  cancelServerOrder: vi.fn(),
}));

vi.mock('../lib/shopServerSync', () => ({
  fetchAllServerOrders,
  fetchServerOrderById,
  cancelServerOrder,
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const SESSION = {
  role: 'SALON',
  userId: 'salon-1',
  user: { salon: { salonName: 'Golden Scissors', ownerName: 'Ramesh Kumar', city: 'Nagpur' } },
};

const seedOrder = () => placeOrder('salon-1', {
  items: [{ productId: 'sp1', name: 'Beard Oil 30ml', price: 199, mrp: 0, image: '', category: 'beard-grooming', gender: 'men', qty: 1 }],
  address: { name: 'Ramesh Kumar', phone: '9876543210', line1: '12 Main Road', city: 'Nagpur', state: 'Maharashtra', pincode: '440010' },
  payment: { method: 'COD', status: 'PENDING', amount: 248 },
  amounts: { itemTotal: 199, savings: 0, deliveryFee: 49, total: 248 },
  salonName: 'Golden Scissors',
});

const flush = async (times = 4) => {
  for (let i = 0; i < times; i += 1) await act(async () => { await Promise.resolve(); });
};

async function render(element) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<ConfirmProvider>{element}</ConfirmProvider>); });
  await flush();
  return { container, root };
}

function buttonByText(label, root = document.body) {
  return Array.from(root.querySelectorAll('button')).find(node => node.textContent.trim().replace(/\s+/g, ' ') === label);
}

beforeEach(() => {
  localStorage.clear();
  fetchAllServerOrders.mockReset();
  fetchAllServerOrders.mockResolvedValue(null); // guests / offline → local copy
  fetchServerOrderById.mockReset();
  fetchServerOrderById.mockResolvedValue(null);
  cancelServerOrder.mockReset();
  cancelServerOrder.mockResolvedValue(true);
  document.body.innerHTML = '';
});

describe('ShopOrdersScreen with the server history', () => {
  it('merges the account history: server copy wins on a shared id, local-only orders survive', async () => {
    const local = seedOrder(); // clock says "placed"
    const serverVersion = {
      ...local,
      serverStatus: 'SHIPPED',
      items: local.items,
    };
    const other = { ...local, id: 'MNSERVER2', serverStatus: 'DELIVERED' };
    fetchAllServerOrders.mockResolvedValue([serverVersion, other]);

    const { container } = await render(<ShopOrdersScreen session={SESSION} navigate={vi.fn()} notify={vi.fn()} />);

    // The local order now carries the server's live track: "Out for delivery".
    expect(container.textContent).toContain(local.id);
    expect(container.textContent).toContain('Out for delivery');
    // The second (delivered) server order lives under the "All" tab.
    await act(async () => { buttonByText('All 2', container).click(); });
    await flush();
    expect(container.textContent).toContain('MNSERVER2');
    expect(container.textContent).toContain('Delivered');
    // Persisted back into the local history for offline visits.
    expect(findOrder('salon-1', local.id).serverStatus).toBe('SHIPPED');
  });

  it('falls back to the local copy when the server is unreachable', async () => {
    const local = seedOrder();
    fetchAllServerOrders.mockResolvedValue(null);
    const { container } = await render(<ShopOrdersScreen session={SESSION} navigate={vi.fn()} notify={vi.fn()} />);
    expect(container.textContent).toContain(local.id);
    expect(container.textContent).toContain('Order placed');
  });
});

describe('ShopOrderScreen with the server status', () => {
  it('shows the live server status instead of the clock', async () => {
    const local = seedOrder();
    fetchServerOrderById.mockResolvedValue({ ...local, serverStatus: 'DELIVERED', items: local.items });
    const { container } = await render(<ShopOrderScreen session={SESSION} params={{ orderId: local.id }} navigate={vi.fn()} notify={vi.fn()} />);

    expect(container.textContent).toContain('Delivered');
    expect(container.textContent).not.toContain('Arriving by');
    expect(container.querySelectorAll('.shop-tracker-step.done')).toHaveLength(4);
  });

  it('cancels through the server for a server-tracked order', async () => {
    const local = seedOrder();
    fetchServerOrderById.mockResolvedValue({ ...local, serverStatus: 'PROCESSING', items: local.items });
    const notify = vi.fn();
    const { container } = await render(<ShopOrderScreen session={SESSION} params={{ orderId: local.id }} navigate={vi.fn()} notify={notify} />);

    // PROCESSING is still cancellable (parcel at the depot), even though a
    // 200-minute-old clock alone would say "shipped".
    expect(buttonByText('Cancel order', container)).toBeTruthy();
    await act(async () => { buttonByText('Cancel order', container).click(); });
    await flush();
    await act(async () => { buttonByText('Cancel order', document.querySelector('.confirm-sheet')).click(); });
    await flush();

    expect(cancelServerOrder).toHaveBeenCalledWith(local.id, expect.any(String));
    expect(findOrder('salon-1', local.id).cancelledAt).toBeTruthy();
    expect(findOrder('salon-1', local.id).serverStatus).toBe('CANCELLED');
    expect(notify).toHaveBeenCalledWith('success', 'Order cancelled.');
  });

  it('does not cancel locally when the server refuses', async () => {
    const local = seedOrder();
    fetchServerOrderById.mockResolvedValue({ ...local, serverStatus: 'PROCESSING', items: local.items });
    cancelServerOrder.mockResolvedValue(false);
    const notify = vi.fn();
    const { container } = await render(<ShopOrderScreen session={SESSION} params={{ orderId: local.id }} navigate={vi.fn()} notify={notify} />);

    await act(async () => { buttonByText('Cancel order', container).click(); });
    await flush();
    await act(async () => { buttonByText('Cancel order', document.querySelector('.confirm-sheet')).click(); });
    await flush();

    expect(findOrder('salon-1', local.id).cancelledAt).toBeNull();
    expect(String(notify.mock.calls.at(-1)?.[1] || '')).toContain('no longer be cancelled');
  });

  it('hides the cancel button once the server track is out for delivery', async () => {
    const local = seedOrder();
    fetchServerOrderById.mockResolvedValue({ ...local, serverStatus: 'SHIPPED', items: local.items });
    const { container } = await render(<ShopOrderScreen session={SESSION} params={{ orderId: local.id }} navigate={vi.fn()} notify={vi.fn()} />);

    expect(container.textContent).toContain('Out for delivery');
    expect(buttonByText('Cancel order', container)).toBeUndefined();
    expect(container.textContent).toContain('already out for delivery');
  });
});
