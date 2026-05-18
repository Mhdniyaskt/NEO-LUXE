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

// ─── Revenue chart data (by filter: yearly/monthly/weekly) ───────────────────
export const getRevenueChartData = async (filter = 'monthly') => {
  const now = new Date();
  let matchStage, groupStage;

  if (filter === 'yearly') {
    // Current year, month-wise (Jan to Dec)
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const endOfYear = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
    matchStage = { createdAt: { $gte: startOfYear, $lte: endOfYear }, paymentStatus: 'paid', status: { $nin: ['cancelled'] } };
    groupStage = { _id: { $month: '$createdAt' }, total: { $sum: '$total' }, count: { $sum: 1 } };
  } else if (filter === 'monthly') {
    // Current month, date-wise (1 to 28/30/31)
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    matchStage = { createdAt: { $gte: startOfMonth, $lte: endOfMonth }, paymentStatus: 'paid', status: { $nin: ['cancelled'] } };
    groupStage = { _id: { $dayOfMonth: '$createdAt' }, total: { $sum: '$total' }, count: { $sum: 1 } };
  } else {
    // Weekly: current week (Mon to Sun)
    const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon, ...
    const diffToMon = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diffToMon, 0, 0, 0, 0);
    const sunday = new Date(monday);
    sunday.setDate(sunday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);
    matchStage = { createdAt: { $gte: monday, $lte: sunday }, paymentStatus: 'paid', status: { $nin: ['cancelled'] } };
    groupStage = { _id: { $dayOfWeek: '$createdAt' }, total: { $sum: '$total' }, count: { $sum: 1 } };
  }

  const data = await Order.aggregate([
    { $match: matchStage },
    { $group: groupStage },
    { $sort: { _id: 1 } },
  ]);

  // Build complete result with zeros for missing slots
  if (filter === 'yearly') {
    // 12 months
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const result = months.map((label, i) => {
      const found = data.find(d => d._id === i + 1);
      return { label, total: found ? found.total : 0, count: found ? found.count : 0 };
    });
    return result;
  } else if (filter === 'monthly') {
    // Days in current month
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const result = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const found = data.find(item => item._id === d);
      result.push({ label: d.toString(), total: found ? found.total : 0, count: found ? found.count : 0 });
    }
    return result;
  } else {
    // Weekly: Mon to Sun
    // MongoDB $dayOfWeek: 1=Sun, 2=Mon, 3=Tue, 4=Wed, 5=Thu, 6=Fri, 7=Sat
    const dayLabels = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    const dayMap = [2, 3, 4, 5, 6, 7, 1]; // Mon=2, Tue=3, ..., Sun=1
    const result = dayLabels.map((label, i) => {
      const found = data.find(d => d._id === dayMap[i]);
      return { label, total: found ? found.total : 0, count: found ? found.count : 0 };
    });
    return result;
  }
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
