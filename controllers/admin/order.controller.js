import mongoose from 'mongoose';
import asyncHandler from '../../utils/asyncHandler.util.js';
import Order from '../../models/order.model.js';
import User  from '../../models/user.model.js';
import Variant from '../../models/variant.model.js';
import { creditWalletService } from '../../services/wallet.service.js';

// ─── GET /admin/orders ────────────────────────────────────────────────────────
export const getOrders = asyncHandler(async (req, res) => {
  const page   = Math.max(1, parseInt(req.query.page)  || 1);
  const limit  = 10;
  const skip   = (page - 1) * limit;

  const { search = '', status = '', paymentStatus = '', date = '', sort = 'newest' } = req.query;

  // Build filter
  const filter = {};
  if (status)        filter.status        = status;
  if (paymentStatus) filter.paymentStatus = paymentStatus;
  if (date) {
    const d = new Date(date);
    if (!isNaN(d)) {
      const next = new Date(d); next.setDate(next.getDate() + 1);
      filter.createdAt = { $gte: d, $lt: next };
    }
  }

  if (search) {
    const trimmed = search.trim();

    // Match by user name/email
    const users = await User.find({
      $or: [
        { name:  { $regex: trimmed, $options: 'i' } },
        { email: { $regex: trimmed, $options: 'i' } },
      ],
    }).select('_id').lean();
    const userIds = users.map(u => u._id);

    // Also try to match by the last 8 chars of _id (the short display ID shown in UI)
    // We do a regex on the string representation of _id
    const shortIdClean = trimmed.replace(/^#/, '').toUpperCase();

    filter.$or = [
      { user: { $in: userIds } },
      // Match orders whose _id ends with the search string (case-insensitive via regex on hex)
      ...(shortIdClean.length >= 4
        ? [{ $expr: { $regexMatch: { input: { $toString: '$_id' }, regex: shortIdClean, options: 'i' } } }]
        : []),
    ];
  }

  // Sort mapping — default is newest first (descending by date)
  const sortMap = {
    newest:      { createdAt: -1 },
    oldest:      { createdAt:  1 },
    amount_high: { total: -1 },
    amount_low:  { total:  1 },
  };
  const sortQuery = sortMap[sort] || { createdAt: -1 };

  const [orders, total] = await Promise.all([
    Order.find(filter)
      .populate('user', 'name email')
      .sort(sortQuery)
      .skip(skip)
      .limit(limit)
      .lean(),
    Order.countDocuments(filter),
  ]);

  const totalPages = Math.ceil(total / limit);

  res.render('admin/orders', {
    layout: 'layouts/admin',
    path: 'orders',
    orders,
    total,
    currentPage: page,
    totalPages,
    search,
    status,
    paymentStatus,
    date,
    sort,
  });
});

// ─── GET /admin/orders/:id ────────────────────────────────────────────────────
export const getOrderDetail = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.redirect('/admin/orders');
  }

  const order = await Order.findById(id)
    .populate('user', 'name email phone createdAt')
    .lean();

  if (!order) return res.redirect('/admin/orders');

  res.render('admin/order-detail', {
    layout: 'layouts/admin',
    path: 'orders',
    order,
  });
});

// ─── PATCH /admin/orders/:id/status ──────────────────────────────────────────
export const updateOrderStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  // Define the allowed progression order (forward only)
  const statusOrder = ['pending', 'confirmed', 'processing', 'shipped', 'delivered'];
  const allowed = [...statusOrder, 'cancelled', 'returned'];

  if (!allowed.includes(status)) {
    return res.status(400).json({ success: false, message: 'Invalid status.' });
  }

  const order = await Order.findById(id);
  if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });

  // Terminal states — cannot be changed
  if (['cancelled', 'returned', 'delivered'].includes(order.status)) {
    return res.status(400).json({
      success: false,
      message: `Order is already "${order.status}" and cannot be updated further.`,
    });
  }

  // Prevent rollback — new status must be forward in the progression
  // (Exception: cancellation is always allowed from any non-terminal state)
  if (status !== 'cancelled') {
    const currentIdx = statusOrder.indexOf(order.status);
    const newIdx = statusOrder.indexOf(status);
    if (newIdx >= 0 && currentIdx >= 0 && newIdx <= currentIdx) {
      return res.status(400).json({
        success: false,
        message: `Cannot move order from "${order.status}" back to "${status}". Status can only move forward.`,
      });
    }
  }

  order.status = status;

  // Keep paymentStatus in sync with order lifecycle
  if (status === 'delivered' && order.paymentMethod === 'cod') {
    order.paymentStatus = 'paid';
  }

  await order.save();

  return res.json({ success: true, message: 'Order status updated.', status: order.status });
});

// ─── PATCH /admin/orders/:id/return ──────────────────────────────────────────
// Approve or reject a return request — supports full order or per-item
export const handleReturn = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { action, itemIndex } = req.body; // action: 'approve'|'reject', itemIndex: optional number

  const order = await Order.findById(id);
  if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });

  // ── Per-item return ──────────────────────────────────────────────────
  if (itemIndex !== undefined && itemIndex !== null && itemIndex !== '') {
    const idx = parseInt(itemIndex, 10);
    if (isNaN(idx) || idx < 0 || idx >= order.items.length) {
      return res.status(400).json({ success: false, message: 'Invalid item index.' });
    }

    const item = order.items[idx];
    if (item.returnStatus !== 'requested') {
      return res.status(400).json({ success: false, message: 'No return request for this item.' });
    }

    if (action === 'approve') {
      order.items[idx].returnStatus = 'approved';
      // Credit this item's amount to wallet ONLY for online-paid orders
      const refundableMethods = ['razorpay', 'wallet'];
      if (order.paymentStatus === 'paid' && refundableMethods.includes(order.paymentMethod)) {
        await creditWalletService({
          userId:      order.user,
          amount:      item.itemTotal,
          description: `Refund for returned item "${item.productName}" — Order #${order._id.toString().slice(-8).toUpperCase()}`,
          orderId:     order._id,
          category:    'refund',
        });
      }
    } else if (action === 'reject') {
      order.items[idx].returnStatus = 'rejected';
    } else {
      return res.status(400).json({ success: false, message: 'Invalid action.' });
    }

    // ── Recalculate order-level status after this action ─────────────
    // Rules:
    // - order.status = 'returned' ONLY when ALL active (non-cancelled) items are approved
    // - order.status = 'delivered' in all other cases (partial returns, all rejected, pending)
    const activeItems = order.items.filter(i => i.status !== 'cancelled');
    const allApproved = activeItems.length > 0 && activeItems.every(i => i.returnStatus === 'approved');

    if (allApproved) {
      order.status        = 'returned';
      order.paymentStatus = (order.paymentStatus === 'paid' && ['razorpay','wallet'].includes(order.paymentMethod))
        ? 'refunded'
        : order.paymentStatus;
    } else {
      // Partial approval, mix of approved+rejected, or still pending — stay delivered
      order.status = 'delivered';
      // Only mark refunded if at least one item was approved (partial refund)
      if (activeItems.some(i => i.returnStatus === 'approved')) {
        order.paymentStatus = 'paid'; // partial refund, not full
      }
    }

    await order.save();
    return res.json({
      success: true,
      message: action === 'approve'
        ? `Item return approved. ₹${item.itemTotal.toLocaleString('en-IN')} refunded to customer wallet.`
        : 'Item return request rejected.',
    });
  }

  // ── Full-order return (no itemIndex) ────────────────────────────────
  // Check that there are actually requested items to process
  const requestedItems = order.items.filter(i => i.returnStatus === 'requested');
  if (requestedItems.length === 0) {
    return res.status(400).json({ success: false, message: 'No pending return requests found.' });
  }

  if (action === 'approve') {
    // Approve all requested items
    order.items.forEach((item, i) => {
      if (item.returnStatus === 'requested') {
        order.items[i].returnStatus = 'approved';
      }
    });

    // Credit sum of all approved items to wallet via wallet service
    const approvedAmount = order.items
      .filter(i => i.returnStatus === 'approved')
      .reduce((sum, i) => sum + i.itemTotal, 0);

    // Only refund to wallet for online-paid orders
    const refundableMethods = ['razorpay', 'wallet'];
    const shouldRefund = order.paymentStatus === 'paid' && refundableMethods.includes(order.paymentMethod);
    if (shouldRefund) {
      await creditWalletService({
        userId:      order.user,
        amount:      approvedAmount,
        description: `Refund for returned order #${order._id.toString().slice(-8).toUpperCase()}`,
        orderId:     order._id,
        category:    'refund',
      });
    }

    order.status        = 'returned';
    order.paymentStatus = shouldRefund ? 'refunded' : order.paymentStatus;

    await order.save();
    return res.json({
      success: true,
      message: shouldRefund
        ? `Return approved. ₹${approvedAmount.toLocaleString('en-IN')} refunded to customer wallet.`
        : 'Return approved.',
    });
  } else if (action === 'reject') {
    // Reject all pending requests and revert to delivered
    order.items.forEach((item, i) => {
      if (item.returnStatus === 'requested') {
        order.items[i].returnStatus = 'rejected';
      }
    });
    order.status = 'delivered';
  } else {
    return res.status(400).json({ success: false, message: 'Invalid action.' });
  }

  await order.save();
  return res.json({
    success: true,
    message: 'Return request rejected. Order reverted to delivered.',
  });
});

// ─── PATCH /admin/orders/:id/restock ─────────────────────────────────────────
// Restore stock for approved-return items.
// If itemIndex is provided → restock that single item.
// Otherwise → restock all pending approved items at once.
export const restockReturnedItems = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { itemIndex } = req.body;

  const order = await Order.findById(id);
  if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });

  // Allow restock for both fully-returned and partially-returned (still 'delivered') orders
  const hasApproved = order.items.some(i => i.returnStatus === 'approved');
  if (!hasApproved) {
    return res.status(400).json({ success: false, message: 'No approved return items to restock.' });
  }

  // ── Per-item restock ─────────────────────────────────────────────────
  if (itemIndex !== undefined && itemIndex !== null && itemIndex !== '') {
    const idx = parseInt(itemIndex, 10);
    if (isNaN(idx) || idx < 0 || idx >= order.items.length) {
      return res.status(400).json({ success: false, message: 'Invalid item index.' });
    }

    const item = order.items[idx];

    if (item.returnStatus !== 'approved') {
      return res.status(400).json({ success: false, message: 'Item return has not been approved.' });
    }
    if (item.stockRestored) {
      return res.status(400).json({ success: false, message: 'Stock already restored for this item.' });
    }

    await Variant.findByIdAndUpdate(item.variant, { $inc: { stock: item.quantity } });
    order.items[idx].stockRestored = true;
    await order.save();

    return res.json({
      success: true,
      message: `Stock restored — ${item.quantity} unit(s) of "${item.productName}" added back to inventory.`,
    });
  }

  // ── Bulk restock (all pending approved items) ────────────────────────
  const toRestock = order.items.filter(
    item => item.returnStatus === 'approved' && !item.stockRestored
  );

  if (toRestock.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'No approved return items pending restock.',
    });
  }

  for (const item of toRestock) {
    await Variant.findByIdAndUpdate(item.variant, { $inc: { stock: item.quantity } });
  }

  order.items.forEach((item, i) => {
    if (item.returnStatus === 'approved' && !item.stockRestored) {
      order.items[i].stockRestored = true;
    }
  });

  await order.save();

  const totalQty = toRestock.reduce((sum, i) => sum + i.quantity, 0);
  return res.json({
    success: true,
    message: `Stock restored for ${toRestock.length} item(s) — ${totalQty} unit(s) added back to inventory.`,
  });
});
