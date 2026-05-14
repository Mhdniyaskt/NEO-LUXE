import Order   from '../models/order.model.js';
import Product from '../models/product.model.js';
import User    from '../models/user.model.js';
import Variant from '../models/variant.model.js';
import mongoose from 'mongoose';

// ─── Summary stats ───────────────────────────────────────────────────────────
export const getDashboardStats = async () => {
  const [totalRevenue]  = await Order.aggregate([
    { $match: { status: { $nin: ['cancelled'] }, paymentStatus: 'paid' } },
    { $group: { _id: null, total: { $sum: '$total' } } },
  ]);

  const totalOrders    = await Order.countDocuments({ status: { $nin: ['cancelled'] } });
  const totalProducts  = await Product.countDocuments({ isDeleted: false });
  const totalCustomers = await User.countDocuments({ role: 'user' });

  const pendingOrders   = await Order.countDocuments({ status: 'pending' });
  const deliveredOrders = await Order.countDocuments({ status: 'delivered' });

  return {
    totalRevenue:    totalRevenue?.total || 0,
    totalOrders,
    totalProducts,
    totalCustomers,
    pendingOrders,
    deliveredOrders,
  };
};

// ─── Revenue chart data (by filter: yearly/monthly/weekly/daily) ─────────────
export const getRevenueChartData = async (filter = 'monthly') => {
  const now   = new Date();
  let matchStage, groupStage, labels;

  if (filter === 'yearly') {
    // Last 5 years
    const startYear = now.getFullYear() - 4;
    matchStage = { createdAt: { $gte: new Date(`${startYear}-01-01`) }, paymentStatus: 'paid', status: { $nin: ['cancelled'] } };
    groupStage = { _id: { $year: '$createdAt' }, total: { $sum: '$total' }, count: { $sum: 1 } };
  } else if (filter === 'monthly') {
    // Last 12 months
    const start = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    matchStage = { createdAt: { $gte: start }, paymentStatus: 'paid', status: { $nin: ['cancelled'] } };
    groupStage = { _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } }, total: { $sum: '$total' }, count: { $sum: 1 } };
  } else if (filter === 'weekly') {
    // Last 7 days
    const start = new Date(); start.setDate(start.getDate() - 6); start.setHours(0,0,0,0);
    matchStage = { createdAt: { $gte: start }, paymentStatus: 'paid', status: { $nin: ['cancelled'] } };
    groupStage = { _id: { $dayOfWeek: '$createdAt' }, total: { $sum: '$total' }, count: { $sum: 1 } };
  } else {
    // Daily — last 30 days
    const start = new Date(); start.setDate(start.getDate() - 29); start.setHours(0,0,0,0);
    matchStage = { createdAt: { $gte: start }, paymentStatus: 'paid', status: { $nin: ['cancelled'] } };
    groupStage = { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, total: { $sum: '$total' }, count: { $sum: 1 } };
  }

  const data = await Order.aggregate([
    { $match: matchStage },
    { $group: groupStage },
    { $sort: { _id: 1 } },
  ]);

  return data;
};

// ─── Best selling products (Top 10) ──────────────────────────────────────────
export const getTopProducts = async (limit = 10) => {
  const result = await Order.aggregate([
    { $match: { status: { $nin: ['cancelled'] } } },
    { $unwind: '$items' },
    { $match: { 'items.status': { $ne: 'cancelled' } } },
    { $group: {
      _id: '$items.product',
      productName: { $first: '$items.productName' },
      totalQty:    { $sum: '$items.quantity' },
      totalRevenue:{ $sum: '$items.itemTotal' },
    }},
    { $sort: { totalQty: -1 } },
    { $limit: limit },
  ]);

  return result;
};

// ─── Best selling categories (Top 10) ────────────────────────────────────────
export const getTopCategories = async (limit = 10) => {
  const result = await Order.aggregate([
    { $match: { status: { $nin: ['cancelled'] } } },
    { $unwind: '$items' },
    { $match: { 'items.status': { $ne: 'cancelled' } } },
    { $lookup: {
      from: 'products',
      localField: 'items.product',
      foreignField: '_id',
      as: 'productInfo',
    }},
    { $unwind: '$productInfo' },
    { $lookup: {
      from: 'categories',
      localField: 'productInfo.category',
      foreignField: '_id',
      as: 'categoryInfo',
    }},
    { $unwind: '$categoryInfo' },
    { $group: {
      _id: '$categoryInfo._id',
      categoryName: { $first: '$categoryInfo.name' },
      totalQty:     { $sum: '$items.quantity' },
      totalRevenue: { $sum: '$items.itemTotal' },
    }},
    { $sort: { totalRevenue: -1 } },
    { $limit: limit },
  ]);

  return result;
};

// ─── Best selling brands (Top 10) ────────────────────────────────────────────
export const getTopBrands = async (limit = 10) => {
  const result = await Order.aggregate([
    { $match: { status: { $nin: ['cancelled'] } } },
    { $unwind: '$items' },
    { $match: { 'items.status': { $ne: 'cancelled' } } },
    { $lookup: {
      from: 'products',
      localField: 'items.product',
      foreignField: '_id',
      as: 'productInfo',
    }},
    { $unwind: '$productInfo' },
    { $group: {
      _id: '$productInfo.brand',
      totalQty:     { $sum: '$items.quantity' },
      totalRevenue: { $sum: '$items.itemTotal' },
    }},
    { $sort: { totalRevenue: -1 } },
    { $limit: limit },
  ]);

  return result;
};

// ─── Recent orders ───────────────────────────────────────────────────────────
export const getRecentOrders = async (limit = 10) => {
  return await Order.find()
    .populate('user', 'name email')
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
};
