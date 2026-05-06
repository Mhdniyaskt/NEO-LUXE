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
    items: checkout.items,
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
      redirectUrl: `/order-confirmation/${result.order._id}`
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
      redirectUrl: `/order-confirmation/${result.order._id}`
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

// ─── GET /order-invoice/:orderId ─────────────────────────────────────────────
export const downloadInvoice = asyncHandler(async (req, res) => {
  const userId = req.session.user.id;
  const { orderId } = req.params;

  const result = await getOrderByIdService(orderId, userId);
  
  if (!result.success) {
    return res.status(404).json({ success: false, message: 'Order not found' });
  }

  const { order } = result;

  // Create PDF invoice
  const doc = new PDFDocument({ margin: 50 });
  
  // Set response headers
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=invoice-${order.orderNumber}.pdf`);
  
  // Pipe PDF to response
  doc.pipe(res);

  // Add invoice content
  doc.fontSize(20).text('NEO LUXE', 50, 50);
  doc.fontSize(16).text('INVOICE', 50, 80);
  
  doc.fontSize(12);
  doc.text(`Order Number: ${order.orderNumber}`, 50, 120);
  doc.text(`Date: ${new Date(order.createdAt).toLocaleDateString()}`, 50, 140);
  doc.text(`Status: ${order.status.toUpperCase()}`, 50, 160);

  // Customer details
  doc.text('Bill To:', 50, 200);
  doc.text(order.shippingAddress.fullName, 50, 220);
  doc.text(order.shippingAddress.streetAddress, 50, 240);
  doc.text(`${order.shippingAddress.city}, ${order.shippingAddress.state} ${order.shippingAddress.pincode}`, 50, 260);
  doc.text(order.shippingAddress.phone, 50, 280);

  // Items table header
  let yPosition = 320;
  doc.text('Item', 50, yPosition);
  doc.text('Qty', 300, yPosition);
  doc.text('Price', 400, yPosition);
  doc.text('Total', 500, yPosition);
  
  // Draw line
  doc.moveTo(50, yPosition + 20).lineTo(550, yPosition + 20).stroke();
  yPosition += 40;

  // Items
  for (const item of order.items) {
    doc.text(`${item.product.name} - ${item.variant.color}`, 50, yPosition);
    doc.text(item.quantity.toString(), 300, yPosition);
    doc.text(`₹${item.price}`, 400, yPosition);
    doc.text(`₹${item.price * item.quantity}`, 500, yPosition);
    yPosition += 20;
  }

  // Totals
  yPosition += 20;
  doc.moveTo(50, yPosition).lineTo(550, yPosition).stroke();
  yPosition += 20;
  
  doc.text(`Subtotal: ₹${order.subtotal}`, 400, yPosition);
  yPosition += 20;
  doc.text(`Tax: ₹${order.tax}`, 400, yPosition);
  yPosition += 20;
  doc.text(`Shipping: ₹${order.shipping}`, 400, yPosition);
  yPosition += 20;
  doc.fontSize(14).text(`Total: ₹${order.total}`, 400, yPosition);

  doc.end();
});