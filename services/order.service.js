import Order from '../models/order.model.js';
import User from '../models/user.model.js';
import Variant from '../models/variant.model.js';
import Product from '../models/product.model.js';
import Cart from '../models/cart.model.js';
import { MESSAGES } from '../constants/messages.constant.js';

// ─── Helper: Calculate order totals ──────────────────────────────────────────
function calculateOrderTotals(items) {
  const subtotal = items.reduce((sum, item) => {
    const price = item.variant?.finalPrice ?? item.variant?.basePrice ?? item.price;
    return sum + (price * item.quantity);
  }, 0);
  
  const shipping = subtotal >= 5000 ? 0 : 50;
  const tax = Math.round(subtotal * 0.18);
  const total = subtotal + tax + shipping;
  
  return { subtotal, shipping, tax, total };
}

// ─── Validate and prepare order items ────────────────────────────────────────
async function validateOrderItems(items) {
  const validItems = [];
  const errors = [];

  for (const item of items) {
    try {
      const product = await Product.findById(item.product).populate('category');
      const variant = await Variant.findById(item.variant);

      // Validate product availability
      if (!product || product.isDeleted || !product.isActive) {
        errors.push(`Product ${item.product} is not available`);
        continue;
      }

      if (!product.category || !product.category.isListed) {
        errors.push(`Product category for ${product.name} is not available`);
        continue;
      }

      if (!variant || variant.isDeleted || !variant.isActive) {
        errors.push(`Variant for ${product.name} is not available`);
        continue;
      }

      if (variant.stock < item.quantity) {
        errors.push(`Insufficient stock for ${product.name}. Available: ${variant.stock}, Requested: ${item.quantity}`);
        continue;
      }

      validItems.push({
        product: item.product,
        variant: item.variant,
        quantity: item.quantity,
        price: variant.finalPrice ?? variant.basePrice,
        productName: product.name,
        variantColor: variant.color,
        productDetails: {
          name: product.name,
          brand: product.brand,
          category: product.category.name
        },
        variantDetails: {
          color: variant.color,
          basePrice: variant.basePrice,
          finalPrice: variant.finalPrice
        }
      });
    } catch (error) {
      errors.push(`Error validating item: ${error.message}`);
    }
  }

  return { validItems, errors };
}

// ─── Create new order ─────────────────────────────────────────────────────────
export const createOrderService = async (orderData) => {
  try {
    const { userId, items, shippingAddress, paymentMethod, paymentStatus = 'pending' } = orderData;

    const user = await User.findById(userId);
    if (!user) {
      return { success: false, message: MESSAGES.ORDER.USER_NOT_FOUND };
    }

    const { validItems, errors } = await validateOrderItems(items);
    if (errors.length > 0) {
      return { success: false, message: `${MESSAGES.ORDER.VALIDATION_FAILED}: ${errors.join(', ')}` };
    }
    if (validItems.length === 0) {
      return { success: false, message: MESSAGES.ORDER.NO_VALID_ITEMS };
    }

    const totals = calculateOrderTotals(validItems);

    const order = new Order({
      user: userId,
      items: validItems.map(item => ({
        product: item.product,
        variant: item.variant,
        quantity: item.quantity,
        price: item.price
      })),
      shippingAddress,
      paymentMethod,
      paymentStatus,
      subtotal: totals.subtotal,
      tax: totals.tax,
      shipping: totals.shipping,
      total: totals.total,
      status: 'pending'
    });

    await order.save();

    // Deduct stock atomically per item
    for (const item of validItems) {
      const result = await Variant.findOneAndUpdate(
        { _id: item.variant, stock: { $gte: item.quantity } },
        { $inc: { stock: -item.quantity } },
        { new: true }
      );
      if (!result) {
        return { success: false, message: `Failed to deduct stock for ${item.productName}. Insufficient stock.` };
      }
    }

    // Clear user's cart
    await Cart.findOneAndUpdate({ user: userId }, { $set: { items: [] } });

    return {
      success: true,
      message: MESSAGES.ORDER.CREATE_SUCCESS,
      order: {
        _id: order._id,
        orderNumber: order._id.toString().slice(-8).toUpperCase(),
        total: order.total,
        status: order.status,
        createdAt: order.createdAt
      }
    };
  } catch (error) {
    console.error('Create order service error:', error);
    return { success: false, message: error.message || MESSAGES.ORDER.CREATE_FAILED };
  }
};

// ─── Get orders with filtering ───────────────────────────────────────────────
export const getOrdersService = async (filters = {}) => {
  try {
    const {
      userId = null,
      page = 1,
      limit = 10,
      search = '',
      status = '',
      paymentStatus = '',
      date = '',
      sort = 'newest',
      isAdmin = false
    } = filters;

    const skip = (page - 1) * limit;

    // Build filter
    const filter = {};
    
    if (userId && !isAdmin) {
      filter.user = userId;
    }

    if (status) filter.status = status;
    if (paymentStatus) filter.paymentStatus = paymentStatus;
    
    if (date) {
      const d = new Date(date);
      if (!isNaN(d)) {
        const next = new Date(d);
        next.setDate(next.getDate() + 1);
        filter.createdAt = { $gte: d, $lt: next };
      }
    }

    // Search functionality (admin only)
    if (search && isAdmin) {
      const trimmed = search.trim();
      
      // Search by user name/email
      const users = await User.find({
        $or: [
          { name: { $regex: trimmed, $options: 'i' } },
          { email: { $regex: trimmed, $options: 'i' } }
        ]
      }).select('_id').lean();
      
      const userIds = users.map(u => u._id);
      
      // Search by order ID (last 8 characters)
      const shortIdClean = trimmed.replace(/^#/, '').toUpperCase();
      
      filter.$or = [
        { user: { $in: userIds } },
        ...(shortIdClean.length >= 4
          ? [{ $expr: { $regexMatch: { input: { $toString: '$_id' }, regex: shortIdClean, options: 'i' } } }]
          : [])
      ];
    }

    // Sort options
    const sortMap = {
      newest: { createdAt: -1 },
      oldest: { createdAt: 1 },
      amount_high: { total: -1 },
      amount_low: { total: 1 }
    };
    const sortQuery = sortMap[sort] || { createdAt: -1 };

    // Get orders
    const orders = await Order.find(filter)
      .populate('user', 'name email')
      .populate({
        path: 'items.product',
        select: 'name brand images'
      })
      .populate({
        path: 'items.variant',
        select: 'color basePrice finalPrice'
      })
      .sort(sortQuery)
      .skip(skip)
      .limit(limit)
      .lean();

    // Add order number for display
    orders.forEach(order => {
      order.orderNumber = order._id.toString().slice(-8).toUpperCase();
    });

    const total = await Order.countDocuments(filter);
    const totalPages = Math.ceil(total / limit);

    return {
      success: true,
      orders,
      pagination: {
        currentPage: page,
        totalPages,
        total,
        hasNext: page < totalPages,
        hasPrev: page > 1
      }
    };
  } catch (error) {
    console.error('Get orders service error:', error);
    return { success: false, message: MESSAGES.ORDER.FETCH_FAILED };
  }
};

// ─── Get single order by ID ──────────────────────────────────────────────────
export const getOrderByIdService = async (orderId, userId = null, isAdmin = false) => {
  try {
    const filter = { _id: orderId };
    if (userId && !isAdmin) {
      filter.user = userId;
    }

    const order = await Order.findOne(filter)
      .populate('user', 'name email phone')
      .populate({
        path: 'items.product',
        select: 'name brand images category',
        populate: { path: 'category', select: 'name' }
      })
      .populate({
        path: 'items.variant',
        select: 'color basePrice finalPrice images'
      })
      .lean();

    if (!order) {
      return { success: false, message: MESSAGES.ORDER.NOT_FOUND };
    }

    order.orderNumber = order._id.toString().slice(-8).toUpperCase();
    return { success: true, order };
  } catch (error) {
    console.error('Get order by ID service error:', error);
    return { success: false, message: MESSAGES.ORDER.FETCH_ONE_FAILED };
  }
};

// ─── Update order status ─────────────────────────────────────────────────────
export const updateOrderStatusService = async (orderId, newStatus, isAdmin = false) => {
  try {
    if (!isAdmin) {
      return { success: false, message: MESSAGES.ORDER.UNAUTHORIZED_STATUS };
    }

    const validStatuses = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled', 'returned'];
    if (!validStatuses.includes(newStatus)) {
      return { success: false, message: MESSAGES.ORDER.STATUS_INVALID };
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return { success: false, message: MESSAGES.ORDER.NOT_FOUND };
    }

    const terminalStatuses = ['delivered', 'cancelled', 'returned'];
    if (terminalStatuses.includes(order.status) && order.status !== newStatus) {
      return { success: false, message: `${MESSAGES.ORDER.STATUS_TERMINAL} ${order.status}` };
    }

    order.status = newStatus;
    
    // Update timestamps
    if (newStatus === 'confirmed') {
      order.confirmedAt = new Date();
    } else if (newStatus === 'shipped') {
      order.shippedAt = new Date();
    } else if (newStatus === 'delivered') {
      order.deliveredAt = new Date();
    }

    await order.save();

    return {
      success: true,
      message: `${MESSAGES.ORDER.STATUS_UPDATED} to ${newStatus}`,
      order: { _id: order._id, status: order.status, updatedAt: order.updatedAt }
    };
  } catch (error) {
    console.error('Update order status service error:', error);
    return { success: false, message: MESSAGES.ORDER.STATUS_UPDATE_FAILED };
  }
};

// ─── Cancel order ─────────────────────────────────────────────────────────────
export const cancelOrderService = async (orderId, userId = null, reason = '', isAdmin = false) => {
  try {
    const filter = { _id: orderId };
    if (userId && !isAdmin) filter.user = userId;

    const order = await Order.findOne(filter);
    if (!order) {
      return { success: false, message: MESSAGES.ORDER.NOT_FOUND };
    }

    if (['delivered', 'cancelled', 'returned'].includes(order.status)) {
      return { success: false, message: `${MESSAGES.ORDER.CANCEL_FORBIDDEN}: ${order.status}` };
    }

    // Restore stock for all items
    for (const item of order.items) {
      await Variant.findByIdAndUpdate(item.variant, { $inc: { stock: item.quantity } });
    }

    order.status = 'cancelled';
    order.cancelledAt = new Date();
    order.cancellationReason = reason;
    await order.save();

    return {
      success: true,
      message: MESSAGES.ORDER.CANCEL_SUCCESS,
      order: { _id: order._id, status: order.status, cancelledAt: order.cancelledAt }
    };
  } catch (error) {
    console.error('Cancel order service error:', error);
    return { success: false, message: error.message || MESSAGES.ORDER.CANCEL_FAILED };
  }
};

// ─── Process return request ──────────────────────────────────────────────────
export const processReturnService = async (orderId, returnData, isAdmin = false) => {
  try {
    if (!isAdmin) {
      return { success: false, message: MESSAGES.ORDER.UNAUTHORIZED_RETURN };
    }

    const { items, reason, refundAmount } = returnData;

    const order = await Order.findById(orderId);
    if (!order) {
      return { success: false, message: MESSAGES.ORDER.NOT_FOUND };
    }

    if (order.status !== 'delivered') {
      return { success: false, message: MESSAGES.ORDER.RETURN_ONLY_DELIVERED };
    }

    if (items && Array.isArray(items)) {
      // Partial return
      for (const returnItem of items) {
        const orderItem = order.items.find(item =>
          item.product.toString() === returnItem.productId &&
          item.variant.toString() === returnItem.variantId
        );
        if (orderItem && returnItem.quantity <= orderItem.quantity) {
          await Variant.findByIdAndUpdate(returnItem.variantId, { $inc: { stock: returnItem.quantity } });
          orderItem.returnStatus = 'returned';
          orderItem.returnedQuantity = returnItem.quantity;
          orderItem.returnReason = reason;
        }
      }
    } else {
      // Full order return
      for (const item of order.items) {
        await Variant.findByIdAndUpdate(item.variant, { $inc: { stock: item.quantity } });
        item.returnStatus = 'returned';
        item.returnedQuantity = item.quantity;
        item.returnReason = reason;
      }
    }

    order.status = 'returned';
    order.returnedAt = new Date();
    order.returnReason = reason;
    order.refundAmount = refundAmount || order.total;
    await order.save();

    return {
      success: true,
      message: MESSAGES.ORDER.RETURN_SUCCESS,
      order: { _id: order._id, status: order.status, refundAmount: order.refundAmount, returnedAt: order.returnedAt }
    };
  } catch (error) {
    console.error('Process return service error:', error);
    return { success: false, message: error.message || MESSAGES.ORDER.RETURN_FAILED };
  }
};

// ─── Get order statistics (admin) ────────────────────────────────────────────
export const getOrderStatsService = async () => {
  try {
    const stats = await Order.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalAmount: { $sum: '$total' }
        }
      }
    ]);

    const totalOrders = await Order.countDocuments();
    const totalRevenue = await Order.aggregate([
      { $match: { status: { $in: ['delivered', 'shipped'] } } },
      { $group: { _id: null, total: { $sum: '$total' } } }
    ]);

    return {
      success: true,
      stats: {
        totalOrders,
        totalRevenue: totalRevenue[0]?.total || 0,
        statusBreakdown: stats
      }
    };
  } catch (error) {
    console.error('Get order stats service error:', error);
    return { success: false, message: MESSAGES.ORDER.STATS_FAILED };
  }
};