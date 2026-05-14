import asyncHandler from '../../utils/asyncHandler.util.js';
import {
  getDashboardStats,
  getRevenueChartData,
  getTopProducts,
  getTopCategories,
  getTopBrands,
  getRecentOrders,
} from '../../services/admin.dashboard.service.js';

// ─── GET /admin/dashboard ─────────────────────────────────────────────────────
export const showAdminDashboard = asyncHandler(async (req, res) => {
  const [stats, topProducts, topCategories, topBrands, recentOrders] = await Promise.all([
    getDashboardStats(),
    getTopProducts(10),
    getTopCategories(10),
    getTopBrands(10),
    getRecentOrders(10),
  ]);

  res.render('admin/dashboard', {
    layout: 'layouts/admin',
    path:   'dashboard',
    stats,
    topProducts,
    topCategories,
    topBrands,
    recentOrders,
  });
});

// ─── GET /admin/dashboard/chart-data?filter=monthly ───────────────────────────
export const getChartData = asyncHandler(async (req, res) => {
  const { filter = 'monthly' } = req.query;
  const data = await getRevenueChartData(filter);
  res.json({ success: true, data, filter });
});
