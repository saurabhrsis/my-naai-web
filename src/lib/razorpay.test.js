import { describe, expect, it } from 'vitest';
import { extractRazorpayOrder, orderAmountInPaise, toPaise } from './razorpay';

// The plan picker used to read only `response.order.id`. Every other shape the
// backend has returned looked like "the payment order came back empty", which
// is the failure partners reported as "Razorpay is not working".
describe('extractRazorpayOrder', () => {
  it('reads the documented { order } envelope', () => {
    const order = extractRazorpayOrder({ status: 'SUCCESS', order: { id: 'order_ABC123', amount: 19900, currency: 'INR' } });
    expect(order.id).toBe('order_ABC123');
    expect(order.amount).toBe(19900);
    expect(order.currency).toBe('INR');
  });

  it('reads an order nested under data', () => {
    expect(extractRazorpayOrder({ data: { order: { id: 'order_NESTED' } } }).id).toBe('order_NESTED');
    expect(extractRazorpayOrder({ data: { id: 'order_DATA' } }).id).toBe('order_DATA');
  });

  it('reads a bare order object and the orderId key', () => {
    expect(extractRazorpayOrder({ id: 'order_BARE' }).id).toBe('order_BARE');
    expect(extractRazorpayOrder({ data: { orderId: 'order_KEYED' } }).id).toBe('order_KEYED');
  });

  it('ignores ids that are not Razorpay order ids', () => {
    // A salon id or a booking id must never be sent to Checkout as an order.
    expect(extractRazorpayOrder({ data: { id: 'salon-42' } })).toBeNull();
    expect(extractRazorpayOrder({ status: 'FAILED', message: 'no order' })).toBeNull();
    expect(extractRazorpayOrder(null)).toBeNull();
  });

  it('defaults the currency and drops a zero amount so the plan price is used', () => {
    const order = extractRazorpayOrder({ order: { id: 'order_NOAMT', amount: 0 } });
    expect(order.currency).toBe('INR');
    expect(order.amount).toBeNull();
    expect(orderAmountInPaise(order, 499)).toBe(49900);
  });

  it('survives a self-referencing response without hanging', () => {
    const response = { data: {} };
    response.data.self = response;
    response.data.order = { id: 'order_CYCLE' };
    expect(extractRazorpayOrder(response).id).toBe('order_CYCLE');
  });
});

describe('amount rules', () => {
  it('converts rupees to paise and floors a free plan at ₹1', () => {
    expect(toPaise(199)).toBe(19900);
    expect(toPaise(0)).toBe(100);
  });

  it('prefers the amount the backend put on the order', () => {
    expect(orderAmountInPaise({ amount: 29900 }, 499)).toBe(29900);
  });
});
