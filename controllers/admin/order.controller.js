import mongoose from 'mongoose';
import asyncHandler from '../../utils/asyncHandler.util.js';
import Order from '../../models/order.model.js';
import User  from '../../models/user.model.js';

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

  const allowed = ['pending','confirmed','processing','shipped','delivered','cancelled','returned'];
  if (!allowed.includes(status)) {
    return res.status(400).json({ success: false, message: 'Invalid status.' });
  }

  // Fetch current order to check if it's in a terminal state
  const order = await Order.findById(id);
  if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });

  // Cancelled, returned, and delivered orders are terminal — status cannot be changed
  if (['cancelled', 'returned', 'delivered'].includes(order.status)) {
    return res.status(400).json({
      success: false,
      message: `Order is ${order.status} and cannot be updated further.`,
    });
  }

  order.status = status;
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
      // Credit this item's amount to the user's wallet
      await User.findByIdAndUpdate(order.user, {
        $inc: { walletBalance: item.itemTotal },
      });
    } else if (action === 'reject') {
      order.items[idx].returnStatus = 'rejected';
    } else {
      return res.status(400).json({ success: false, message: 'Invalid action.' });
    }

    // If all requested items are now resolved (approved/rejected), update order-level status
    const activeItems = order.items.filter(i => i.status !== 'cancelled');
    const allApproved = activeItems.every(i => i.returnStatus === 'approved');
    const anyRequested = activeItems.some(i => i.returnStatus === 'requested');

    if (allApproved) {
      order.paymentStatus = 'refunded';
    }
    // If no more pending requests, revert order status to delivered (unless all approved)
    if (!anyRequested && !allApproved) {
      order.status = 'delivered';
    }

    await order.save();
    return res.json({
      success: true,
      message: action === 'approve'
        ? `Item return approved. ₹${item.itemTotal.toLocaleString('en-IN')} refunded to customer wallet.`
        : 'Item return request rejected.',
    });
  }

  // ── Full-order return ────────────────────────────────────────────────
  if (order.status !== 'returned') {
    return res.status(400).json({ success: false, message: 'Order is not in returned state.' });
  }

  if (action === 'approve') {
    // Credit full order amount to wallet
    await User.findByIdAndUpdate(order.user, {
      $inc: { walletBalance: order.total },
    });
    // Mark all requested items as approved
    order.items.forEach((item, i) => {
      if (item.returnStatus === 'requested') {
        order.items[i].returnStatus = 'approved';
      }
    });
    order.paymentStatus = 'refunded';
  } else if (action === 'reject') {
    // Reject all pending return requests and revert order
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
    message: action === 'approve'
      ? `Return approved. ₹${order.total.toLocaleString('en-IN')} refunded to customer wallet.`
      : 'Return request rejected. Order reverted to delivered.',
  });
});
