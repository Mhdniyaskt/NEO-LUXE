import Order from '../models/order.model.js';

// ─── Get sales report data with filters ──────────────────────────────────────
export const getSalesReportService = async ({ startDate, endDate, page = 1, limit = 15 }) => {
  const filter = {
    status: { $nin: ['cancelled'] },
    paymentStatus: 'paid',
  };

  if (startDate && endDate) {
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
    filter.createdAt = { $gte: start, $lte: end };
  }

  // Summary aggregation
  const [summary] = await Order.aggregate([
    { $match: filter },
    { $group: {
      _id: null,
      totalRevenue:  { $sum: '$total' },
      totalOrders:   { $sum: 1 },
      totalDiscount: { $sum: { $ifNull: ['$discount', 0] } },
      totalSubtotal: { $sum: '$subtotal' },
      avgOrderValue: { $avg: '$total' },
    }},
  ]);

  // Paginated orders
  const skip  = (page - 1) * limit;
  const total = await Order.countDocuments(filter);

  const orders = await Order.find(filter)
    .populate('user', 'name email phone')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  // Revenue trend for the filtered period (daily breakdown)
  const trendData = await Order.aggregate([
    { $match: filter },
    { $group: {
      _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
      total: { $sum: '$total' },
      count: { $sum: 1 },
    }},
    { $sort: { _id: 1 } },
  ]);

  // Sales by category
  const categoryData = await Order.aggregate([
    { $match: filter },
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
      _id: '$categoryInfo.name',
      totalRevenue: { $sum: '$items.itemTotal' },
      totalQty:     { $sum: '$items.quantity' },
      totalOrders:  { $addToSet: '$_id' },
    }},
    { $addFields: { orderCount: { $size: '$totalOrders' } } },
    { $project: { totalOrders: 0 } },
    { $sort: { totalRevenue: -1 } },
    { $limit: 10 },
  ]);

  return {
    summary: summary || { totalRevenue: 0, totalOrders: 0, totalDiscount: 0, totalSubtotal: 0, avgOrderValue: 0 },
    orders,
    trendData,
    categoryData,
    pagination: {
      currentPage: page,
      totalPages:  Math.ceil(total / limit),
      total,
    },
  };
};

// ─── Get full export data (no pagination) ────────────────────────────────────
export const getFullExportDataService = async ({ startDate, endDate }) => {
  const filter = {
    status: { $nin: ['cancelled'] },
    paymentStatus: 'paid',
  };

  if (startDate && endDate) {
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
    filter.createdAt = { $gte: start, $lte: end };
  }

  // Summary
  const [summary] = await Order.aggregate([
    { $match: filter },
    { $group: {
      _id: null,
      totalRevenue:  { $sum: '$total' },
      totalSubtotal: { $sum: '$subtotal' },
      totalOrders:   { $sum: 1 },
      totalDiscount: { $sum: { $ifNull: ['$discount', 0] } },
      avgOrderValue: { $avg: '$total' },
    }},
  ]);

  // All orders (no pagination)
  const orders = await Order.find(filter)
    .populate('user', 'name email phone')
    .sort({ createdAt: -1 })
    .lean();

  // Category sales
  const categoryData = await Order.aggregate([
    { $match: filter },
    { $unwind: '$items' },
    { $match: { 'items.status': { $ne: 'cancelled' } } },
    { $lookup: { from: 'products', localField: 'items.product', foreignField: '_id', as: 'productInfo' } },
    { $unwind: '$productInfo' },
    { $lookup: { from: 'categories', localField: 'productInfo.category', foreignField: '_id', as: 'categoryInfo' } },
    { $unwind: '$categoryInfo' },
    { $group: {
      _id: '$categoryInfo.name',
      totalRevenue: { $sum: '$items.itemTotal' },
      totalQty:     { $sum: '$items.quantity' },
      orderIds:     { $addToSet: '$_id' },
    }},
    { $addFields: { orderCount: { $size: '$orderIds' } } },
    { $project: { orderIds: 0 } },
    { $sort: { totalRevenue: -1 } },
  ]);

  // Product sales
  const productData = await Order.aggregate([
    { $match: filter },
    { $unwind: '$items' },
    { $match: { 'items.status': { $ne: 'cancelled' } } },
    { $lookup: { from: 'products', localField: 'items.product', foreignField: '_id', as: 'productInfo' } },
    { $unwind: '$productInfo' },
    { $lookup: { from: 'categories', localField: 'productInfo.category', foreignField: '_id', as: 'categoryInfo' } },
    { $unwind: '$categoryInfo' },
    { $group: {
      _id: '$items.product',
      productName:  { $first: '$items.productName' },
      categoryName: { $first: '$categoryInfo.name' },
      brand:        { $first: '$productInfo.brand' },
      totalQty:     { $sum: '$items.quantity' },
      totalRevenue: { $sum: '$items.itemTotal' },
    }},
    { $sort: { totalQty: -1 } },
  ]);

  // Brand sales
  const brandData = await Order.aggregate([
    { $match: filter },
    { $unwind: '$items' },
    { $match: { 'items.status': { $ne: 'cancelled' } } },
    { $lookup: { from: 'products', localField: 'items.product', foreignField: '_id', as: 'productInfo' } },
    { $unwind: '$productInfo' },
    { $group: {
      _id: '$productInfo.brand',
      totalQty:     { $sum: '$items.quantity' },
      totalRevenue: { $sum: '$items.itemTotal' },
    }},
    { $sort: { totalRevenue: -1 } },
  ]);

  return {
    summary: summary || { totalRevenue: 0, totalSubtotal: 0, totalOrders: 0, totalDiscount: 0, avgOrderValue: 0 },
    orders,
    categoryData,
    productData,
    brandData,
  };
};
