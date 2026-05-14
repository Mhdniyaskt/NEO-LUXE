import asyncHandler from '../../utils/asyncHandler.util.js';
import { getSalesReportService } from '../../services/sales-report.service.js';

// ─── GET /admin/sales-report ──────────────────────────────────────────────────
export const getSalesReport = asyncHandler(async (req, res) => {
  const { filter = 'month', startDate, endDate, page = 1 } = req.query;

  // Compute date range from preset filter
  let computedStart, computedEnd;
  const now = new Date();

  if (startDate && endDate) {
    computedStart = startDate;
    computedEnd   = endDate;
  } else if (filter === 'today') {
    computedStart = computedEnd = now.toISOString().split('T')[0];
  } else if (filter === 'week') {
    const start = new Date(now);
    start.setDate(start.getDate() - 6);
    computedStart = start.toISOString().split('T')[0];
    computedEnd   = now.toISOString().split('T')[0];
  } else if (filter === 'month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    computedStart = start.toISOString().split('T')[0];
    computedEnd   = now.toISOString().split('T')[0];
  } else if (filter === 'year') {
    const start = new Date(now.getFullYear(), 0, 1);
    computedStart = start.toISOString().split('T')[0];
    computedEnd   = now.toISOString().split('T')[0];
  } else {
    // Default: this month
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    computedStart = start.toISOString().split('T')[0];
    computedEnd   = now.toISOString().split('T')[0];
  }

  const result = await getSalesReportService({
    startDate: computedStart,
    endDate:   computedEnd,
    page:      parseInt(page),
    limit:     15,
  });

  res.render('admin/sales-report', {
    layout:       'layouts/admin',
    path:         'sales-report',
    ...result,
    filter,
    startDate:    computedStart,
    endDate:      computedEnd,
    currentPage:  result.pagination.currentPage,
    totalPages:   result.pagination.totalPages,
    total:        result.pagination.total,
  });
});
