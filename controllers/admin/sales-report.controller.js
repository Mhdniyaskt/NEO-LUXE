import asyncHandler from '../../utils/asyncHandler.util.js';
import { getSalesReportService, getFullExportDataService } from '../../services/sales-report.service.js';
import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';

// ─── Helper: compute date range from filter ───────────────────────────────────
function getDateRange(filter, startDate, endDate) {
  const now = new Date();
  let computedStart, computedEnd;

  if (startDate && endDate && filter === 'custom') {
    computedStart = startDate;
    computedEnd = endDate;
  } else if (filter === 'today') {
    computedStart = computedEnd = now.toISOString().split('T')[0];
  } else if (filter === 'week') {
    const start = new Date(now);
    const day = start.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    start.setDate(start.getDate() + diff);
    computedStart = start.toISOString().split('T')[0];
    computedEnd = now.toISOString().split('T')[0];
  } else if (filter === 'year') {
    const start = new Date(now.getFullYear(), 0, 1);
    computedStart = start.toISOString().split('T')[0];
    computedEnd = now.toISOString().split('T')[0];
  } else {
    // Default: this month
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    computedStart = start.toISOString().split('T')[0];
    computedEnd = now.toISOString().split('T')[0];
  }

  return { computedStart, computedEnd };
}

// ─── GET /admin/sales-report ──────────────────────────────────────────────────
export const getSalesReport = asyncHandler(async (req, res) => {
  const { filter = 'month', startDate, endDate, page = 1 } = req.query;

  const { computedStart, computedEnd } = getDateRange(filter, startDate, endDate);

  const result = await getSalesReportService({
    startDate: computedStart,
    endDate: computedEnd,
    page: parseInt(page),
    limit: 15,
  });

  res.render('admin/sales-report', {
    layout: 'layouts/admin',
    path: 'sales-report',
    ...result,
    filter,
    startDate: computedStart,
    endDate: computedEnd,
    currentPage: result.pagination.currentPage,
    totalPages: result.pagination.totalPages,
    total: result.pagination.total,
  });
});

// ─── GET /admin/sales-report/download/pdf ─────────────────────────────────────
export const downloadSalesReportPDF = asyncHandler(async (req, res) => {
  const { filter = 'month', startDate, endDate } = req.query;
  const { computedStart, computedEnd } = getDateRange(filter, startDate, endDate);

  const result = await getSalesReportService({
    startDate: computedStart,
    endDate: computedEnd,
    page: 1,
    limit: 1000,
  });

  const { summary, orders } = result;

  const doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'landscape' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=sales-report-${computedStart}-to-${computedEnd}.pdf`);
  doc.pipe(res);

  // Header
  doc.rect(0, 0, 842, 80).fill('#05080d');
  doc.fillColor('#22d3ee').fontSize(20).font('Helvetica-Bold').text('NEO LUXE', 40, 25);
  doc.fillColor('#94a3b8').fontSize(9).font('Helvetica').text('Sales & Revenue Report', 40, 50);
  doc.fillColor('#ffffff').fontSize(12).font('Helvetica-Bold').text('SALES REPORT', 620, 28);
  doc.fillColor('#22d3ee').fontSize(9).font('Helvetica').text(`${computedStart} to ${computedEnd}`, 620, 48);

  let y = 100;

  // Summary
  doc.fillColor('#0f172a').fontSize(10).font('Helvetica-Bold');
  doc.text(`Total Revenue: Rs.${(summary.totalRevenue || 0).toLocaleString('en-IN')}`, 40, y);
  doc.text(`Total Orders: ${summary.totalOrders || 0}`, 250, y);
  doc.text(`Avg Order Value: Rs.${Math.round(summary.avgOrderValue || 0).toLocaleString('en-IN')}`, 420, y);
  doc.text(`Total Discounts: Rs.${(summary.totalDiscount || 0).toLocaleString('en-IN')}`, 620, y);
  y += 30;

  // Table header
  doc.fillColor('#0f172a').rect(40, y, 762, 22).fill();
  doc.fillColor('#ffffff').fontSize(8).font('Helvetica-Bold');
  doc.text('ORDER ID', 45, y + 7);
  doc.text('DATE', 130, y + 7);
  doc.text('CUSTOMER', 220, y + 7);
  doc.text('PAYMENT', 350, y + 7);
  doc.text('STATUS', 430, y + 7);
  doc.text('SUBTOTAL', 510, y + 7);
  doc.text('DISCOUNT', 590, y + 7);
  doc.text('TOTAL', 680, y + 7);
  y += 22;

  // Table rows
  orders.forEach((order, idx) => {
    if (y > 540) {
      doc.addPage();
      y = 40;
    }
    const bg = idx % 2 === 0 ? '#f8fafc' : '#f1f5f9';
    doc.fillColor(bg).rect(40, y, 762, 20).fill();
    doc.fillColor('#0f172a').fontSize(8).font('Helvetica');
    doc.text('#' + order._id.toString().slice(-8).toUpperCase(), 45, y + 6);
    doc.text(new Date(order.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }), 130, y + 6);
    doc.text(order.user ? order.user.name : 'Deleted', 220, y + 6, { width: 120, ellipsis: true });
    doc.text(order.paymentMethod === 'cod' ? 'COD' : order.paymentMethod === 'razorpay' ? 'Razorpay' : 'Wallet', 350, y + 6);
    doc.text(order.status.toUpperCase(), 430, y + 6);
    doc.text('Rs.' + (order.subtotal || order.total).toLocaleString('en-IN'), 510, y + 6);
    doc.text('Rs.' + (order.discount || 0).toLocaleString('en-IN'), 590, y + 6);
    doc.font('Helvetica-Bold').text('Rs.' + order.total.toLocaleString('en-IN'), 680, y + 6);
    doc.font('Helvetica');
    y += 20;
  });

  // Footer
  y += 20;
  doc.fillColor('#94a3b8').fontSize(7).font('Helvetica')
    .text('Generated on ' + new Date().toLocaleString('en-IN'), 40, y, { align: 'center', width: 762 });

  doc.end();
});

// ─── GET /admin/sales-report/download/excel ───────────────────────────────────
export const downloadSalesReportExcel = asyncHandler(async (req, res) => {
  const { filter = 'month', startDate, endDate } = req.query;
  const { computedStart, computedEnd } = getDateRange(filter, startDate, endDate);

  const filterLabels = { today: 'Today', week: 'This Week', month: 'This Month', year: 'This Year', custom: 'Custom Range' };
  const filterLabel = filterLabels[filter] || 'This Month';

  const { summary, orders, categoryData, productData, brandData } = await getFullExportDataService({
    startDate: computedStart,
    endDate: computedEnd,
  });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Neo-Luxe Admin';
  workbook.created = new Date();

  // ═══════════════════════════════════════════════════════════════════════════
  // SHEET 1: Orders (Main report like the reference image)
  // ═══════════════════════════════════════════════════════════════════════════
  const ws = workbook.addWorksheet('Sales Report');

  // Define columns
  ws.columns = [
    { header: '', key: 'slNo', width: 5 },
    { header: 'Order #', key: 'orderId', width: 20 },
    { header: 'Date', key: 'date', width: 12 },
    { header: 'Customer', key: 'customer', width: 20 },
    { header: 'Email', key: 'email', width: 28 },
    { header: 'Payment Method', key: 'paymentMethod', width: 18 },
    { header: 'Payment Status', key: 'paymentStatus', width: 16 },
    { header: 'Order Status', key: 'orderStatus', width: 18 },
    { header: 'Subtotal (₹)', key: 'subtotal', width: 14 },
    { header: 'Product Disc (₹)', key: 'productDisc', width: 16 },
    { header: 'Coupon Disc (₹)', key: 'couponDisc', width: 16 },
    { header: 'GST (₹)', key: 'gst', width: 10 },
    { header: 'Delivery (₹)', key: 'delivery', width: 12 },
    { header: 'Grand Total (₹)', key: 'grandTotal', width: 16 },
  ];

  // Style header row (row 1) — green background like the image
  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true, size: 10 };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF92D050' } };
  headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
  headerRow.height = 20;

  // Add order rows
  let totalSubtotal = 0;
  let totalProductDisc = 0;
  let totalCouponDisc = 0;
  let totalGST = 0;
  let totalDelivery = 0;
  let totalGrand = 0;

  if (orders.length === 0) {
    ws.addRow({ slNo: '', orderId: 'No orders found for this period' });
  } else {
    orders.forEach((order, idx) => {
      const subtotal = order.subtotal || order.total || 0;
      const couponDisc = order.discount || 0;
      const productDisc = 0; // offer discount already reflected in item prices
      const gst = order.tax || 0;
      const delivery = order.shipping || 0;
      const grandTotal = order.total || 0;

      totalSubtotal += subtotal;
      totalProductDisc += productDisc;
      totalCouponDisc += couponDisc;
      totalGST += gst;
      totalDelivery += delivery;
      totalGrand += grandTotal;

      ws.addRow({
        slNo: idx + 1,
        orderId: 'ORD-' + order._id.toString().slice(-8).toUpperCase(),
        date: new Date(order.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'numeric', year: 'numeric' }),
        customer: order.user ? order.user.name : 'Deleted',
        email: order.user ? order.user.email : '-',
        paymentMethod: order.paymentMethod === 'cod' ? 'COD' : order.paymentMethod === 'razorpay' ? 'RAZORPAY' : 'WALLET',
        paymentStatus: (order.paymentStatus || 'pending').toUpperCase(),
        orderStatus: (order.status || 'pending').toUpperCase(),
        subtotal: subtotal,
        productDisc: productDisc,
        couponDisc: couponDisc,
        gst: gst,
        delivery: delivery,
        grandTotal: grandTotal,
      });
    });

    // Empty row before totals
    ws.addRow({});

    // GROSS SALES row (green text like image)
    const grossRow = ws.addRow({
      slNo: '', orderId: 'GROSS SALES  (paid orders)', date: '', customer: '', email: '',
      paymentMethod: '', paymentStatus: '', orderStatus: '',
      subtotal: totalSubtotal, productDisc: totalProductDisc, couponDisc: totalCouponDisc,
      gst: totalGST, delivery: totalDelivery, grandTotal: totalGrand,
    });
    grossRow.font = { bold: true, color: { argb: 'FF008000' } };
    grossRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFCC' } };

    // NET SALES row
    const netSales = totalGrand;
    const netRow = ws.addRow({
      slNo: '', orderId: 'NET SALES', date: '', customer: '', email: '',
      paymentMethod: '', paymentStatus: '', orderStatus: '',
      subtotal: '', productDisc: '', couponDisc: '',
      gst: '', delivery: '', grandTotal: netSales,
    });
    netRow.font = { bold: true, color: { argb: 'FF008000' } };

    // Summary info row
    ws.addRow({});
    const infoRow = ws.addRow({
      slNo: '', orderId: `Total Orders: ${orders.length}  |  Filter: ${filterLabel}  |  Period: ${computedStart} to ${computedEnd}`,
    });
    infoRow.font = { bold: true, size: 9 };
  }

  // Format number columns
  ['subtotal', 'productDisc', 'couponDisc', 'gst', 'delivery', 'grandTotal'].forEach(key => {
    ws.getColumn(key).numFmt = '#,##0.00';
    ws.getColumn(key).alignment = { horizontal: 'right' };
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SHEET 2: Category Sales
  // ═══════════════════════════════════════════════════════════════════════════
  const catSheet = workbook.addWorksheet('Category Sales');
  catSheet.columns = [
    { header: 'Sl No', key: 'slNo', width: 7 },
    { header: 'Category Name', key: 'categoryName', width: 25 },
    { header: 'Items Sold', key: 'itemsSold', width: 12 },
    { header: 'Total Orders', key: 'totalOrders', width: 13 },
    { header: 'Total Revenue (₹)', key: 'totalRevenue', width: 18 },
  ];
  const catHdr = catSheet.getRow(1);
  catHdr.font = { bold: true, size: 10 };
  catHdr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF92D050' } };

  if (categoryData.length === 0) {
    catSheet.addRow({ slNo: '', categoryName: 'No data found' });
  } else {
    categoryData.forEach((cat, idx) => {
      catSheet.addRow({ slNo: idx + 1, categoryName: cat._id, itemsSold: cat.totalQty, totalOrders: cat.orderCount || 0, totalRevenue: cat.totalRevenue });
    });
  }
  catSheet.getColumn('totalRevenue').numFmt = '#,##0.00';

  // ═══════════════════════════════════════════════════════════════════════════
  // SHEET 3: Product Sales
  // ═══════════════════════════════════════════════════════════════════════════
  const prodSheet = workbook.addWorksheet('Product Sales');
  prodSheet.columns = [
    { header: 'Sl No', key: 'slNo', width: 7 },
    { header: 'Product Name', key: 'productName', width: 30 },
    { header: 'Category', key: 'category', width: 20 },
    { header: 'Brand', key: 'brand', width: 18 },
    { header: 'Qty Sold', key: 'qtySold', width: 10 },
    { header: 'Total Revenue (₹)', key: 'totalRevenue', width: 18 },
  ];
  const prodHdr = prodSheet.getRow(1);
  prodHdr.font = { bold: true, size: 10 };
  prodHdr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF92D050' } };

  if (productData.length === 0) {
    prodSheet.addRow({ slNo: '', productName: 'No data found' });
  } else {
    productData.forEach((prod, idx) => {
      prodSheet.addRow({ slNo: idx + 1, productName: prod.productName || 'Unknown', category: prod.categoryName || '-', brand: prod.brand || '-', qtySold: prod.totalQty, totalRevenue: prod.totalRevenue });
    });
  }
  prodSheet.getColumn('totalRevenue').numFmt = '#,##0.00';

  // ═══════════════════════════════════════════════════════════════════════════
  // SHEET 4: Brand Sales
  // ═══════════════════════════════════════════════════════════════════════════
  const brandSheet = workbook.addWorksheet('Brand Sales');
  brandSheet.columns = [
    { header: 'Sl No', key: 'slNo', width: 7 },
    { header: 'Brand Name', key: 'brandName', width: 25 },
    { header: 'Qty Sold', key: 'qtySold', width: 10 },
    { header: 'Total Revenue (₹)', key: 'totalRevenue', width: 18 },
  ];
  const brandHdr = brandSheet.getRow(1);
  brandHdr.font = { bold: true, size: 10 };
  brandHdr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF92D050' } };

  if (brandData.length === 0) {
    brandSheet.addRow({ slNo: '', brandName: 'No data found' });
  } else {
    brandData.forEach((brand, idx) => {
      brandSheet.addRow({ slNo: idx + 1, brandName: brand._id || 'Unknown', qtySold: brand.totalQty, totalRevenue: brand.totalRevenue });
    });
  }
  brandSheet.getColumn('totalRevenue').numFmt = '#,##0.00';

  // ═══════════════════════════════════════════════════════════════════════════
  // Send
  // ═══════════════════════════════════════════════════════════════════════════
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=sales-report-${computedStart}-to-${computedEnd}.xlsx`);

  await workbook.xlsx.write(res);
  res.end();
});
