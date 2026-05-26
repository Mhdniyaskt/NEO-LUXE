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

  // ── Refund this item to wallet if order was paid online ──────────────
  const refundableMethods = ['razorpay', 'wallet'];
  const wasPaid = order.paymentStatus === 'paid' && refundableMethods.includes(order.paymentMethod);
  if (wasPaid) {
    await creditWalletService({
      userId:      order.user,
      amount:      item.itemTotal,
      description: `Refund for cancelled item "${item.productName}" — Order #${order._id.toString().slice(-8).toUpperCase()}`,
      orderId:     order._id,
      category:    'cancellation',
    });
  }

  const refundMsg = wasPaid
    ? ` ₹${item.itemTotal.toLocaleString('en-IN')} refunded to your wallet.`
    : '';

  return res.json({
    success: true,
    message: allCancelled
      ? `All items cancelled. Order has been cancelled.${refundMsg}`
      : `Item cancelled and stock restored.${refundMsg}`
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
    message = 'The product went out of stock while your payment was being processed. Your payment has been automatically refunded. It will appear in your account within 5–7 business days.';
  }

  res.render('user/payment-failed', {
    layout:        'layouts/user',
    path:          'orders',
    title,
    message,
    reason:        reason || null,
  });
});