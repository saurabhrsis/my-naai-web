const crypto = require('crypto');
const db = require('../../database/models');

/**
 * Razorpay webhook receiver — public, but every call must carry a valid
 * HMAC-SHA256 signature (`x-razorpay-signature`) computed over the RAW body
 * with the shared webhook secret (`RAZORPAY_WEBHOOK_SECRET`), configured in
 * the Razorpay dashboard under Webhooks. The signature is checked against
 * `req.rawBody` (captured by the express.json verify hook in index.js)
 * because re-serialising a parsed body is not byte-identical and would make
 * every signature check fail.
 *
 * The shop pays order-less through Checkout, so correlation is by payment id:
 * when the client registers the order via /api/shop-orders/create it stores
 * the `razorpay_payment_id` on the order, and this hook flips it to PAID the
 * moment Razorpay confirms the capture.
 *
 * Every successfully signed event is acknowledged with 200 (even when no
 * order matches) so Razorpay stops retrying; failures to act are logged.
 */

const timingSafeEqualHex = (expectedHex, givenHex) => {
  if (typeof givenHex !== 'string' || givenHex.length === 0) return false;
  const a = crypto.createHash('sha256').update(expectedHex).digest();
  const b = crypto.createHash('sha256').update(givenHex).digest();
  return crypto.timingSafeEqual(a, b);
};

const applyPaymentOutcome = async (paymentId, outcome) => {
  const order = await db.ShopOrder.findOne({ where: { payment: { paymentId } } });
  if (!order) {
    // Payment captured for an order the client has not registered yet (or a
    // non-shop payment). Nothing to flip — support can reconcile manually.
    console.log(`[razorpay-webhook] ${outcome} for payment ${paymentId}: no shop order registered`);
    return null;
  }
  order.payment = { ...order.payment, status: outcome };
  // A captured payment confirms the order on the SALON track only; the
  // INTERNAL track still waits for a delivery partner (PENDING_ASSIGNMENT).
  if (outcome === 'PAID' && order.customerStatus === 'PENDING') {
    order.customerStatus = 'CONFIRMED';
  }
  await order.save();
  return order;
};

const razorpayWebhook = async (request, response) => {
  try {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) {
      return response.status(400).json({
        status: 'FAILED',
        message: 'Webhook secret is not configured (RAZORPAY_WEBHOOK_SECRET)'
      });
    }

    const signature = request.headers['x-razorpay-signature'] || '';
    const rawBody = request.rawBody;
    if (!rawBody || !signature) {
      return response.status(400).json({
        status: 'FAILED',
        message: 'Missing webhook signature or body'
      });
    }

    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    if (!timingSafeEqualHex(expected, signature)) {
      return response.status(400).json({
        status: 'FAILED',
        message: 'Invalid webhook signature'
      });
    }

    const event = JSON.parse(rawBody.toString('utf8'));
    const type = event?.event;
    const entity = event?.payload?.payment?.entity || {};
    const paymentId = entity.id || '';

    switch (type) {
      case 'payment.captured':
        await applyPaymentOutcome(paymentId, 'PAID');
        break;
      case 'payment.failed':
        if (paymentId) await applyPaymentOutcome(paymentId, 'FAILED');
        break;
      case 'payment.refunded':
        if (paymentId) await applyPaymentOutcome(paymentId, 'REFUNDED');
        break;
      default:
        // Acknowledge every other event type (order.paid, captures.created …).
        break;
    }

    return response.status(200).json({
      status: 'SUCCESS',
      message: 'Webhook processed',
      data: { event: type, received: true }
    });
  } catch (error) {
    console.log('razorpay webhook error', error);
    return response.status(500).json({
      status: 'FAILED',
      message: error.message
    });
  }
};

module.exports = razorpayWebhook;
