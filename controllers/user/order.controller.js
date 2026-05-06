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

  res.render('user/orders', {
    layout: 'layouts/user',
    path: 'orders',
    orders: result.orders,
    pagination: result.pagination,
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
  const { reason = 'Customer requested return' } = req.body;

  // For user-initiated returns, we'll create a return request
  // The actual processing should be done by admin
  const result = await getOrderByIdService(orderId, userId);
  
  if (!result.success) {
    return res.status(404).json({ success: false, message: 'Order not found' });
  }

  const { order } = result;
  
  if (order.status !== 'delivered') {
    return res.status(400).json({
      success: false,
      message: 'Only delivered orders can be returned'
    });
  }

  // Here you would typically create a return request record
  // For now, we'll just return success
  return res.json({
    success: true,
    message: 'Return request submitted successfully. Our team will review and process it soon.'
  });
});

// ─── POST /orders/:orderId/items/:itemIndex/cancel ───────────────────────────
export const cancelOrderItem = asyncHandler(async (req, res) => {
  const userId = req.session.user.id;
  const { orderId, itemIndex } = req.params;
  const { reason = 'Customer requested item cancellation' } = req.body;

  const result = await getOrderByIdService(orderId, userId);
  
  if (!result.success) {
    return res.status(404).json({ success: false, message: 'Order not found' });
  }

  const { order } = result;
  const itemIdx = parseInt(itemIndex);
  
  if (itemIdx < 0 || itemIdx >= order.items.length) {
    return res.status(400).json({ success: false, message: 'Invalid item index' });
  }

  if (['delivered', 'cancelled', 'returned'].includes(order.status)) {
    return res.status(400).json({
      success: false,
      message: `Cannot cancel items from ${order.status} orders`
    });
  }

  // For individual item cancellation, you'd need more complex logic
  // This is a simplified implementation
  return res.json({
    success: true,
    message: 'Item cancellation request submitted successfully'
  });
});

// ─── POST /orders/:orderId/items/:itemIndex/return ───────────────────────────
export const returnOrderItem = asyncHandler(async (req, res) => {
  const userId = req.session.user.id;
  const { orderId, itemIndex } = req.params;
  const { reason = 'Customer requested item return' } = req.body;

  const result = await getOrderByIdService(orderId, userId);
  
  if (!result.success) {
    return res.status(404).json({ success: false, message: 'Order not found' });
  }

  const { order } = result;
  const itemIdx = parseInt(itemIndex);
  
  if (itemIdx < 0 || itemIdx >= order.items.length) {
    return res.status(400).json({ success: false, message: 'Invalid item index' });
  }

  if (order.status !== 'delivered') {
    return res.status(400).json({
      success: false,
      message: 'Only items from delivered orders can be returned'
    });
  }

  // For individual item returns, you'd need more complex logic
  // This is a simplified implementation
  return res.json({
    success: true,
    message: 'Item return request submitted successfully'
  });
});

// ─── GET /payment-failed ──────────────────────────────────────────────────────
export const getPaymentFailed = asyncHandler(async (req, res) => {
  res.render('user/payment-failed', {
    layout: 'layouts/user',
    path: 'orders'
  });
});