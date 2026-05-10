import mongoose from 'mongoose';
import asyncHandler from '../../utils/asyncHandler.util.js';
import {
  getCheckoutDataService,
  validateBuyNowService,
  processCheckoutService,
  validateCheckoutService
} from '../../services/checkout.service.js';
import { getUserAddressesService } from '../../services/address.service.js';
import { getOrderByIdService } from '../../services/order.service.js';
import PDFDocument from 'pdfkit';

// ─── GET /checkout ────────────────────────────────────────────────────────────
export const getCheckout = asyncHandler(async (req, res) => {
  const userId = req.session.user.id;

  const result = await getCheckoutDataService(userId);
  
  if (!result.success) {
    if (result.message === 'Cart is empty') {
      return res.redirect('/cart');
    }
    
    req.session.cartFlash = result.message;
    return res.redirect('/cart');
  }

  const { checkout } = result;
  
  res.render('user/checkout', {
    layout: 'layouts/user',
    path: 'checkout',
    checkoutItems: checkout.items,
    addresses: checkout.addresses,
    totals: checkout.totals,
    blockedItems: checkout.issues.blockedItems,
    stockErrors: checkout.issues.stockErrors
  });
});

// ─── POST /checkout/place-order ──────────────────────────────────────────────
export const placeOrder = asyncHandler(async (req, res) => {
  const userId = req.session.user.id;
  const { addressId, paymentMethod } = req.body;

  // Validate inputs
  if (!addressId || !paymentMethod) {
    return res.status(400).json({
      success: false,
      message: 'Address and payment method are required'
    });
  }

  if (!['cod', 'razorpay', 'wallet'].includes(paymentMethod)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid payment method'
    });
  }

  // Validate checkout before processing
  const validation = await validateCheckoutService(userId, addressId);
  if (!validation.success) {
    return res.status(400).json(validation);
  }

  // Process checkout
  const result = await processCheckoutService({
    userId,
    addressId,
    paymentMethod,
    isBuyNow: false
  });

  if (result.success) {
    return res.json({
      success: true,
      message: result.message,
      orderId: result.order._id,
      orderNumber: result.order.orderNumber,
      redirect: `/orders/${result.order._id}`
    });
  }

  return res.status(400).json(result);
});

// ─── GET /buy-now/:productId/:variantId ──────────────────────────────────────
export const getBuyNow = asyncHandler(async (req, res) => {
  const userId = req.session.user.id;
  const { productId, variantId } = req.params;
  const { quantity = 1 } = req.query;

  // Validate buy now item
  const validation = await validateBuyNowService(productId, variantId, quantity);
  if (!validation.success) {
    return res.status(400).render('error', {
      message: validation.message,
      layout: 'layouts/user'
    });
  }

  // Get user addresses
  const addressResult = await getUserAddressesService(userId, 1, 50);
  const addresses = addressResult.success ? addressResult.addresses : [];

  const { buyNow } = validation;

  res.render('user/checkout', {
    layout: 'layouts/user',
    path: 'checkout',
    items: [buyNow.item],
    addresses,
    totals: buyNow.totals,
    isBuyNow: true,
    buyNowData: {
      productId,
      variantId,
      quantity: parseInt(quantity)
    }
  });
});

// ─── POST /buy-now/place-order ───────────────────────────────────────────────
export const placeBuyNowOrder = asyncHandler(async (req, res) => {
  const userId = req.session.user.id;
  const { addressId, paymentMethod, productId, variantId, quantity } = req.body;

  // Validate inputs
  if (!addressId || !paymentMethod || !productId || !variantId || !quantity) {
    return res.status(400).json({
      success: false,
      message: 'All fields are required'
    });
  }

  // Validate checkout
  const validation = await validateCheckoutService(userId, addressId, [{
    productId,
    variantId,
    quantity: parseInt(quantity)
  }]);

  if (!validation.success) {
    return res.status(400).json(validation);
  }

  // Process buy now order
  const result = await processCheckoutService({
    userId,
    addressId,
    paymentMethod,
    items: [{
      productId,
      variantId,
      quantity: parseInt(quantity)
    }],
    isBuyNow: true
  });

  if (result.success) {
    return res.json({
      success: true,
      message: result.message,
      orderId: result.order._id,
      orderNumber: result.order.orderNumber,
      redirect: `/orders/${result.order._id}`
    });
  }

  return res.status(400).json(result);
});

// ─── GET /order-confirmation/:orderId ────────────────────────────────────────
export const getOrderConfirmation = asyncHandler(async (req, res) => {
  const userId = req.session.user.id;
  const { orderId } = req.params;

  const result = await getOrderByIdService(orderId, userId);
  
  if (!result.success) {
    return res.status(404).render('error', {
      message: 'Order not found',
      layout: 'layouts/user'
    });
  }

  res.render('user/order-confirmation', {
    layout: 'layouts/user',
    path: 'orders',
    order: result.order
  });
});

// ─── GET /orders/:orderId/invoice ────────────────────────────────────────────
export const downloadInvoice = asyncHandler(async (req, res) => {
  const userId  = req.session.user.id;
  const { orderId } = req.params;

  const result = await getOrderByIdService(orderId, userId);
  if (!result.success) {
    return res.status(404).json({ success: false, message: 'Order not found' });
  }

  const { order } = result;

  // Only allow invoice download for delivered orders
  if (order.status !== 'delivered') {
    return res.status(400).json({ success: false, message: 'Invoice is only available for delivered orders' });
  }

  // Only include items that were actually delivered (not cancelled, not returned/approved)
  const deliveredItems = order.items.filter(
    i => i.status !== 'cancelled' && i.returnStatus !== 'approved'
  );

  // Recalculate totals from delivered items only
  const subtotal = deliveredItems.reduce((sum, i) => sum + (i.itemTotal || i.basePrice * i.quantity || 0), 0);
  const shipping  = subtotal >= 5000 ? 0 : 50;
  const tax       = Math.round(subtotal * 0.18);
  const total     = subtotal + shipping + tax;

  const doc = new PDFDocument({ margin: 50, size: 'A4' });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=invoice-${order.orderNumber || orderId.slice(-8).toUpperCase()}.pdf`);
  doc.pipe(res);

  // ── Header ────────────────────────────────────────────────────────────
  doc.rect(0, 0, 595, 120).fill('#05080d');
  doc.fillColor('#22d3ee').fontSize(26).font('Helvetica-Bold').text('NEO LUXE', 50, 35);
  doc.fillColor('#94a3b8').fontSize(10).font('Helvetica').text('Premium Watch Collection', 50, 65);
  doc.fillColor('#ffffff').fontSize(22).font('Helvetica-Bold').text('INVOICE', 430, 40);
  doc.fillColor('#22d3ee').fontSize(10).font('Helvetica').text(`#${order.orderNumber || orderId.slice(-8).toUpperCase()}`, 430, 68);

  // ── Order meta ────────────────────────────────────────────────────────
  let y = 140;
  doc.fillColor('#1e293b').rect(50, y, 495, 1).fill();
  y += 15;

  doc.fillColor('#64748b').fontSize(8).font('Helvetica-Bold').text('ORDER DATE', 50, y);
  doc.fillColor('#64748b').fontSize(8).font('Helvetica-Bold').text('PAYMENT METHOD', 220, y);
  doc.fillColor('#64748b').fontSize(8).font('Helvetica-Bold').text('STATUS', 390, y);
  y += 14;
  doc.fillColor('#0f172a').fontSize(10).font('Helvetica').text(
    new Date(order.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }), 50, y);
  doc.fillColor('#0f172a').fontSize(10).font('Helvetica').text(
    order.paymentMethod === 'cod' ? 'Cash on Delivery' : 'Online Payment', 220, y);
  doc.fillColor('#16a34a').fontSize(10).font('Helvetica-Bold').text('DELIVERED', 390, y);
  y += 30;

  doc.fillColor('#1e293b').rect(50, y, 495, 1).fill();
  y += 20;

  // ── Bill To ───────────────────────────────────────────────────────────
  doc.fillColor('#64748b').fontSize(8).font('Helvetica-Bold').text('BILL TO', 50, y);
  y += 14;
  doc.fillColor('#0f172a').fontSize(11).font('Helvetica-Bold').text(order.shippingAddress.fullName, 50, y);
  y += 16;
  const addr = [
    order.shippingAddress.addressLine1,
    order.shippingAddress.addressLine2,
    `${order.shippingAddress.city}, ${order.shippingAddress.state} ${order.shippingAddress.pincode}`,
  ].filter(Boolean).join(', ');
  doc.fillColor('#334155').fontSize(10).font('Helvetica').text(addr, 50, y, { width: 250 });
  y += doc.heightOfString(addr, { width: 250 }) + 6;
  doc.fillColor('#334155').fontSize(10).text(`Phone: ${order.shippingAddress.phone}`, 50, y);
  y += 30;

  // ── Items table ───────────────────────────────────────────────────────
  // Header row
  doc.fillColor('#0f172a').rect(50, y, 495, 28).fill();
  doc.fillColor('#ffffff').fontSize(9).font('Helvetica-Bold');
  doc.text('ITEM', 60, y + 9);
  doc.text('COLOR', 290, y + 9);
  doc.text('QTY', 360, y + 9, { width: 40, align: 'center' });
  doc.text('UNIT PRICE', 410, y + 9, { width: 70, align: 'right' });
  doc.text('TOTAL', 490, y + 9, { width: 55, align: 'right' });
  y += 28;

  // Item rows
  deliveredItems.forEach((item, idx) => {
    const rowBg = idx % 2 === 0 ? '#f8fafc' : '#f1f5f9';
    const unitPrice = item.basePrice || 0;
    const lineTotal = item.itemTotal || (unitPrice * item.quantity) || 0;

    doc.fillColor(rowBg).rect(50, y, 495, 26).fill();
    doc.fillColor('#0f172a').fontSize(9).font('Helvetica-Bold').text(item.productName || '—', 60, y + 8, { width: 220, ellipsis: true });
    doc.fillColor('#475569').fontSize(9).font('Helvetica').text(item.variantColor || '—', 290, y + 8, { width: 60 });
    doc.fillColor('#0f172a').fontSize(9).font('Helvetica').text(String(item.quantity), 360, y + 8, { width: 40, align: 'center' });
    doc.fillColor('#0f172a').fontSize(9).font('Helvetica').text(`Rs.${unitPrice.toLocaleString('en-IN')}`, 410, y + 8, { width: 70, align: 'right' });
    doc.fillColor('#0f172a').fontSize(9).font('Helvetica-Bold').text(`Rs.${lineTotal.toLocaleString('en-IN')}`, 490, y + 8, { width: 55, align: 'right' });
    y += 26;
  });

  y += 15;

  // ── Totals ────────────────────────────────────────────────────────────
  const totalsX = 370;
  const valX    = 490;
  const valW    = 55;

  doc.fillColor('#e2e8f0').rect(totalsX, y, 175, 1).fill();
  y += 12;

  doc.fillColor('#64748b').fontSize(9).font('Helvetica').text('Subtotal', totalsX, y);
  doc.fillColor('#0f172a').fontSize(9).font('Helvetica').text(`Rs.${subtotal.toLocaleString('en-IN')}`, valX, y, { width: valW, align: 'right' });
  y += 16;

  doc.fillColor('#64748b').fontSize(9).font('Helvetica').text('Shipping', totalsX, y);
  doc.fillColor(shipping === 0 ? '#16a34a' : '#0f172a').fontSize(9).font('Helvetica').text(
    shipping === 0 ? 'FREE' : `Rs.${shipping}`, valX, y, { width: valW, align: 'right' });
  y += 16;

  doc.fillColor('#64748b').fontSize(9).font('Helvetica').text('Tax (18% GST)', totalsX, y);
  doc.fillColor('#0f172a').fontSize(9).font('Helvetica').text(`Rs.${tax.toLocaleString('en-IN')}`, valX, y, { width: valW, align: 'right' });
  y += 12;

  doc.fillColor('#e2e8f0').rect(totalsX, y, 175, 1).fill();
  y += 12;

  doc.fillColor('#0f172a').rect(totalsX - 5, y - 4, 185, 28).fill();
  doc.fillColor('#ffffff').fontSize(11).font('Helvetica-Bold').text('TOTAL', totalsX, y + 4);
  doc.fillColor('#22d3ee').fontSize(13).font('Helvetica-Bold').text(`Rs.${total.toLocaleString('en-IN')}`, valX - 10, y + 3, { width: valW + 10, align: 'right' });
  y += 40;

  // ── Footer ────────────────────────────────────────────────────────────
  doc.fillColor('#e2e8f0').rect(50, y, 495, 1).fill();
  y += 15;
  doc.fillColor('#94a3b8').fontSize(8).font('Helvetica')
     .text('Thank you for shopping with Neo Luxe. For support, contact us at support@neoluxe.com', 50, y, { align: 'center', width: 495 });
  y += 14;
  doc.fillColor('#cbd5e1').fontSize(7).font('Helvetica')
     .text('This is a computer-generated invoice and does not require a signature.', 50, y, { align: 'center', width: 495 });

  doc.end();
});
