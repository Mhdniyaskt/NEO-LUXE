import asyncHandler from '../../utils/asyncHandler.util.js';
import {
  getOrdersService,
  getOrderByIdService,
  cancelOrderService,
  processReturnService
} from '../../services/order.service.js';

// ─── GET /orders ──────────────────────────────────────────────────────────────
export const getOrders = asyncHandler(async (req, res) => {
  const userId = req.session.user.id;
  const { page = 1, status = '', search = '' } = req.query;

  const result = await getOrdersService({
    userId,
    page: parseInt(page),
    limit: 10,
    status,
    search,
    isAdmin: false
  });

  if (!result.success) {
    return res.status(500).render('error', {
      message: result.message,
      layout: 'layouts/user'
    });
  }
  res.locals.activePage = 'orders';
  res.render('user/orders', {
    layout: 'layouts/user',
    path: 'orders',
    orders: result.orders,
    currentPage: result.pagination.currentPage,
    totalPages: result.pagination.totalPages,
    total: result.pagination.total,
    currentStatus: status,
    search
  });
});

// ─── GET /orders/:orderId/details ─────────────────────────────────────────────
export const getOrderDetails = asyncHandler(async (req, res) => {
  const userId = req.session.user.id;
  const { orderId } = req.params;

  const result = await getOrderByIdService(orderId, userId);
  
  if (!result.success) {
    return res.status(404).render('error', {
      message: 'Order not found',
      layout: 'layouts/user'
    });
  }

  res.render('user/order-details', {
    layout: 'layouts/user',
    path: 'orders',
    order: result.order
  });
});

// ─── POST /orders/:orderId/cancel ─────────────────────────────────────────────
export const cancelOrder = asyncHandler(async (req, res) => {
  const userId = req.session.user.id;
  const { orderId } = req.params;
  const { reason = 'Customer requested cancellation' } = req.body;

  const result = await cancelOrderService(orderId, userId, reason);
  
  if (result.success) {
    return res.json({
      success: true,
      message: result.message
    });
  }
  
  return res.status(400).json(result);
});

// ─── POST /orders/:orderId/return ─────────────────────────────────────────────
export const returnOrder = asyncHandler(async (req, res) => {
  const userId = req.session.user.id;
  const { orderId } = req.params;
  const { reason } = req.body;

  if (!reason || !reason.trim()) {
    return res.status(400).json({ success: false, message: 'Please provide a reason for the return' });
  }

  const Order = (await import('../../models/order.model.js')).default;

  const order = await Order.findOne({ _id: orderId, user: userId });
  if (!order) {
    return res.status(404).json({ success: false, message: 'Order not found' });
  }

  if (order.status !== 'delivered') {
    return res.status(400).json({
      success: false,
      message: 'Only delivered orders can be returned'
    });
  }

  // Mark all active (non-cancelled, not-yet-requested) items as return-requested
  // DO NOT flip order.status — stays 'delivered' until admin approves
  order.items.forEach((item, i) => {
    if (item.status !== 'cancelled' && item.returnStatus === 'none') {
      order.items[i].returnStatus = 'requested';
      order.items[i].returnReason = reason.trim();
    }
  });

  await order.save();

  return res.json({
    success: true,
    message: 'Return request submitted. Our team will review it within 24–48 hours.'
  });
});

// ─── POST /orders/:orderId/items/:itemIndex/cancel ───────────────────────────
export const cancelOrderItem = asyncHandler(async (req, res) => {
  const userId = req.session.user.id;
  const { orderId, itemIndex } = req.params;
  const { reason = 'Customer requested item cancellation' } = req.body;

  const Order   = (await import('../../models/order.model.js')).default;
  const Variant = (await import('../../models/variant.model.js')).default;
  const { creditWalletService } = await import('../../services/wallet.service.js');

  const order = await Order.findOne({ _id: orderId, user: userId });
  if (!order) {
    return res.status(404).json({ success: false, message: 'Order not found' });
  }

  const itemIdx = parseInt(itemIndex);
  if (isNaN(itemIdx) || itemIdx < 0 || itemIdx >= order.items.length) {
    return res.status(400).json({ success: false, message: 'Invalid item index' });
  }

  if (['delivered', 'cancelled', 'returned'].includes(order.status)) {
    return res.status(400).json({
      success: false,
      message: `Cannot cancel items from a ${order.status} order`
    });
  }

  const item = order.items[itemIdx];
  if (item.status === 'cancelled') {
    return res.status(400).json({ success: false, message: 'Item is already cancelled' });
  }

  // Mark item as cancelled and restore stock
  order.items[itemIdx].status = 'cancelled';
  await Variant.findByIdAndUpdate(item.variant, { $inc: { stock: item.quantity } });

  // If ALL items are now cancelled → cancel the whole order
  const allCancelled = order.items.every(i => i.status === 'cancelled');
  if (allCancelled) {
    order.status = 'cancelled';
    order.cancelReason = reason;
  }

  await order.save();

  // ── Refund to wallet if order was paid online ──────────────────────
  // Rule: Always refund THIS item's proportional share of total paid.
  // When last item is cancelled (allCancelled), do NOT refund order.total
  // because previous items may have already been partially refunded.
  // Instead, calculate the remaining unrefunded amount = total - sum of
  // proportional refunds already credited for previously cancelled items.
  const refundableMethods = ['razorpay', 'wallet'];
  const wasPaid = order.paymentStatus === 'paid' && refundableMethods.includes(order.paymentMethod);
  if (wasPaid) {
    let refundAmount;

    const totalItemsValue = order.items.reduce((s, i) => s + (i.itemTotal || 0), 0);

    if (allCancelled) {
      // Last item being cancelled — check if this is the FIRST cancellation
      // (i.e., no prior per-item refunds were issued for this order).
      // Count how many items were already cancelled BEFORE this one.
      const previouslyCancelledCount = order.items.filter(
        (i, idx) => idx !== itemIdx && i.status === 'cancelled'
      ).length;

      if (previouslyCancelledCount === 0) {
        // No prior cancellations — safe to refund full order total
        refundAmount = order.total;
      } else {
        // Prior cancellations already gave proportional refunds.
        // Only refund THIS item's proportional share to avoid double-refunding.
        if (totalItemsValue > 0) {
          const itemShare           = item.itemTotal / totalItemsValue;
          const proportionalTax     = Math.round((order.tax      || 0) * itemShare);
          const proportionalShip    = Math.round((order.shipping || 0) * itemShare);
          const proportionalDisc    = Math.round((order.discount || 0) * itemShare);
          refundAmount = Math.max(0, item.itemTotal + proportionalTax + proportionalShip - proportionalDisc);
        } else {
          refundAmount = item.itemTotal;
        }
      }
    } else {
      // Partial cancellation — proportional share of total paid
      if (totalItemsValue > 0) {
        const itemShare           = item.itemTotal / totalItemsValue;
        const proportionalTax     = Math.round((order.tax      || 0) * itemShare);
        const proportionalShipping = Math.round((order.shipping || 0) * itemShare);
        const proportionalDiscount = Math.round((order.discount || 0) * itemShare);
        refundAmount = Math.max(0, item.itemTotal + proportionalTax + proportionalShipping - proportionalDiscount);
      } else {
        refundAmount = item.itemTotal;
      }
    }

    await creditWalletService({
      userId:      order.user,
      amount:      refundAmount,
      description: allCancelled
        ? `Full refund for cancelled order #${order._id.toString().slice(-8).toUpperCase()}`
        : `Refund for cancelled item "${item.productName}" — Order #${order._id.toString().slice(-8).toUpperCase()}`,
      orderId:     order._id,
      category:    'cancellation',
    });

    const refundMsg = ` ₹${refundAmount.toLocaleString('en-IN')} refunded to your wallet.`;

    return res.json({
      success: true,
      message: allCancelled
        ? `All items cancelled. Order has been cancelled.${refundMsg}`
        : `Item cancelled and stock restored.${refundMsg}`
    });
  }

  // No refund for COD orders
  return res.json({
    success: true,
    message: allCancelled
      ? 'All items cancelled. Order has been cancelled.'
      : 'Item cancelled and stock restored.'
  });
});

// ─── POST /orders/:orderId/items/:itemIndex/return ───────────────────────────
export const returnOrderItem = asyncHandler(async (req, res) => {
  const userId = req.session.user.id;
  const { orderId, itemIndex } = req.params;
  const { reason } = req.body;

  if (!reason || !reason.trim()) {
    return res.status(400).json({ success: false, message: 'Please provide a reason for the return' });
  }

  const Order = (await import('../../models/order.model.js')).default;

  const order = await Order.findOne({ _id: orderId, user: userId });
  if (!order) {
    return res.status(404).json({ success: false, message: 'Order not found' });
  }

  const itemIdx = parseInt(itemIndex);
  if (isNaN(itemIdx) || itemIdx < 0 || itemIdx >= order.items.length) {
    return res.status(400).json({ success: false, message: 'Invalid item index' });
  }

  // Only allow returns on delivered orders
  if (order.status !== 'delivered') {
    return res.status(400).json({
      success: false,
      message: 'Only items from delivered orders can be returned'
    });
  }

  const item = order.items[itemIdx];

  if (item.status === 'cancelled') {
    return res.status(400).json({ success: false, message: 'Cannot return a cancelled item' });
  }

  if (item.returnStatus !== 'none') {
    return res.status(400).json({
      success: false,
      message: `Return already ${item.returnStatus} for this item`
    });
  }

  // Mark only this item as return-requested
  // DO NOT flip order.status — it stays 'delivered' until admin approves
  order.items[itemIdx].returnStatus = 'requested';
  order.items[itemIdx].returnReason = reason.trim();

  await order.save();

  return res.json({
    success: true,
    message: 'Return request submitted. Our team will review it within 24–48 hours.'
  });
});

// ─── GET /payment-failed ──────────────────────────────────────────────────────
export const getPaymentFailed = asyncHandler(async (req, res) => {
  const { reason } = req.query;

  let title   = 'Payment Failed';
  let message = 'Your payment could not be completed. Please try again or use a different payment method.';

  if (reason === 'outofstock') {
    title   = 'Product Out of Stock';
    message = 'The product went out of stock while your payment was being processed. Your payment has been instantly refunded to your wallet.';
  }

  res.render('user/payment-failed', {
    layout:        'layouts/user',
    path:          'orders',
    title,
    message,
    reason:        reason || null,
  });
});