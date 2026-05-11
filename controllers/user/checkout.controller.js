import Razorpay from 'razorpay';
import crypto   from 'crypto';
import asyncHandler from '../../utils/asyncHandler.util.js';
import {
  getCheckoutDataService,
  validateBuyNowService,
  validateCheckoutService,
  getCartTotalsService,
  processCheckoutService,
  processRazorpayOrderService,
} from '../../services/checkout.service.js';
import { getUserAddressesService } from '../../services/address.service.js';
import { getOrderByIdService }     from '../../services/order.service.js';
import User       from '../../models/user.model.js';
import PDFDocument from 'pdfkit';

// ─── Razorpay instance ────────────────────────────────────────────────────────
const razorpay = new Razorpay({
  key_id:     process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /checkout
// ═══════════════════════════════════════════════════════════════════════════════
export const getCheckout = asyncHandler(async (req, res) => {
  const userId = req.session.user.id;
  const result = await getCheckoutDataService(userId);

  if (!result.success) {
    if (result.message === 'Cart is empty') return res.redirect('/cart');
    req.session.cartFlash = result.message;
    return res.redirect('/cart');
  }

  const { checkout } = result;

  // Get wallet balance to show on checkout page
  const userDoc = await User.findById(userId).select('walletBalance').lean();

  res.render('user/checkout', {
    layout:        'layouts/user',
    path:          'checkout',
    checkoutItems: checkout.items,
    addresses:     checkout.addresses,
    totals:        checkout.totals,
    blockedItems:  checkout.issues.blockedItems,
    stockErrors:   checkout.issues.stockErrors,
    razorpayKeyId: process.env.RAZORPAY_KEY_ID,
    walletBalance: userDoc?.walletBalance || 0,
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /checkout/place-order  — COD only
// ═══════════════════════════════════════════════════════════════════════════════
export const placeOrder = asyncHandler(async (req, res) => {
  const userId = req.session.user.id;
  const { addressId, paymentMethod } = req.body;

  if (!addressId || !paymentMethod)
    return res.status(400).json({ success: false, message: 'Address and payment method are required' });

  // Only COD and wallet go through this route — Razorpay has its own flow
  if (!['cod', 'wallet'].includes(paymentMethod))
    return res.status(400).json({ success: false, message: 'Use the Razorpay flow for online payments' });

  const validation = await validateCheckoutService(userId, addressId);
  if (!validation.success) return res.status(400).json(validation);

  const result = await processCheckoutService({ userId, addressId, paymentMethod, isBuyNow: false });

  if (result.success) {
    return res.json({
      success:     true,
      message:     result.message,
      orderId:     result.order._id,
      orderNumber: result.order.orderNumber,
      redirect:    `/orders/${result.order._id}`,
    });
  }

  return res.status(400).json(result);
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /checkout/razorpay/create-order
// Step 1 of Razorpay flow:
//   - Validate cart + address (NO stock deduction, NO DB order)
//   - Create a Razorpay order for the amount
//   - Store addressId in session for use after verification
// ═══════════════════════════════════════════════════════════════════════════════
export const createRazorpayOrder = asyncHandler(async (req, res) => {
  const userId    = req.session.user.id;
  const { addressId } = req.body;

  if (!addressId)
    return res.status(400).json({ success: false, message: 'Address is required' });

  // Validate cart + address — no side effects
  const validation = await validateCheckoutService(userId, addressId);
  if (!validation.success) return res.status(400).json(validation);

  // Get cart totals to know the amount — no side effects
  const totalsResult = await getCartTotalsService(userId);
  if (!totalsResult.success) return res.status(400).json(totalsResult);

  // Create Razorpay order (amount in paise)
  let rzpOrder;
  try {
    rzpOrder = await razorpay.orders.create({
      amount:   Math.round(totalsResult.totals.total * 100),
      currency: 'INR',
      receipt:  `ord_${userId.toString().slice(-8)}_${Date.now().toString().slice(-8)}`,
    });
  } catch (rzpErr) {
    console.error('Razorpay order creation failed:', rzpErr);
    return res.status(500).json({
      success: false,
      message: 'Payment gateway error. Please try again or use Cash on Delivery.',
    });
  }

  // Store addressId in session so verify endpoint can use it
  req.session.razorpayPending = { addressId, razorpayOrderId: rzpOrder.id };

  return res.json({
    success:         true,
    razorpayOrderId: rzpOrder.id,
    amount:          rzpOrder.amount,
    currency:        rzpOrder.currency,
    keyId:           process.env.RAZORPAY_KEY_ID,
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /checkout/razorpay/verify
// Step 2 of Razorpay flow (called from Razorpay handler callback):
//   - Verify HMAC signature
//   - THEN try to deduct stock atomically + create DB order
//   - If stock ran out (race condition): initiate Razorpay refund automatically
// ═══════════════════════════════════════════════════════════════════════════════
export const verifyRazorpayPayment = asyncHandler(async (req, res) => {
  const userId = req.session.user.id;
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature)
    return res.status(400).json({ success: false, message: 'Missing payment details' });

  // Retrieve addressId stored before the popup opened
  const pending = req.session.razorpayPending;
  if (!pending || pending.razorpayOrderId !== razorpay_order_id) {
    return res.status(400).json({ success: false, message: 'Invalid payment session. Please try again.' });
  }

  // ── Verify HMAC-SHA256 signature ──────────────────────────────────────────
  const expectedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');

  if (expectedSignature !== razorpay_signature) {
    delete req.session.razorpayPending;
    return res.status(400).json({ success: false, message: 'Payment verification failed. Please contact support.' });
  }

  // ── Signature valid — NOW try to create order + deduct stock atomically ───
  const result = await processRazorpayOrderService({
    userId,
    addressId:         pending.addressId,
    razorpayPaymentId: razorpay_payment_id,
    razorpayOrderId:   razorpay_order_id,
  });

  // Clear pending session data regardless of outcome
  delete req.session.razorpayPending;

  if (result.success) {
    return res.json({
      success:  true,
      message:  'Payment verified and order placed successfully',
      redirect: `/orders/${result.order._id}`,
    });
  }

  // ── Stock ran out (race condition) — user paid but we can't fulfil ────────
  // Initiate automatic Razorpay refund
  if (result.outOfStock) {
    try {
      await razorpay.payments.refund(razorpay_payment_id, {
        speed: 'optimum', // 'normal' (5-7 days) or 'optimum' (instant if supported)
        notes: { reason: 'Out of stock — automatic refund' },
      });
      console.log(`Auto-refund initiated for payment ${razorpay_payment_id} — stock exhausted`);
    } catch (refundErr) {
      // Refund failed — log it for manual processing, but still tell the user
      console.error(`REFUND FAILED for payment ${razorpay_payment_id}:`, refundErr);
    }

    return res.status(409).json({
      success:    false,
      outOfStock: true,
      message:    result.message,
    });
  }

  // Other error (address gone, cart empty, etc.)
  return res.status(400).json({ success: false, message: result.message });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /checkout/razorpay/failed
// Called when user dismisses popup or payment.failed fires
// No order exists yet — nothing to clean up
// ═══════════════════════════════════════════════════════════════════════════════
export const handleRazorpayFailure = asyncHandler(async (req, res) => {
  // Clear any pending session data
  delete req.session.razorpayPending;
  return res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /buy-now/:productId/:variantId
// ═══════════════════════════════════════════════════════════════════════════════
export const getBuyNow = asyncHandler(async (req, res) => {
  const userId = req.session.user.id;
  const { productId, variantId } = req.params;
  const { quantity = 1 } = req.query;

  const validation = await validateBuyNowService(productId, variantId, quantity);
  if (!validation.success) {
    return res.status(400).render('error', { message: validation.message, layout: 'layouts/user' });
  }

  const addressResult = await getUserAddressesService(userId, 1, 50);
  const addresses     = addressResult.success ? addressResult.addresses : [];
  const { buyNow }    = validation;

  const buyNowCheckoutItem = {
    productId:    buyNow.item.product._id,
    variantId:    buyNow.item.variant._id,
    productName:  buyNow.item.product.name,
    brand:        buyNow.item.product.brand || '',
    color:        buyNow.item.variant.color,
    imageUrl:     buyNow.item.variant.images?.[0]?.url || buyNow.item.product.images?.[0]?.url || null,
    quantity:     buyNow.item.quantity,
    basePrice:    buyNow.item.variant.basePrice,
    regularPrice: buyNow.item.variant.regularPrice ?? buyNow.item.variant.basePrice,
    finalPrice:   buyNow.item.variant.finalPrice   ?? buyNow.item.variant.basePrice,
    itemTotal:    buyNow.item.variant.basePrice * buyNow.item.quantity,
  };

  res.render('user/checkout', {
    layout:        'layouts/user',
    path:          'checkout',
    checkoutItems: [buyNowCheckoutItem],
    addresses,
    totals:        buyNow.totals,
    isBuyNow:      true,
    blockedItems:  [],
    stockErrors:   [],
    razorpayKeyId: process.env.RAZORPAY_KEY_ID,
    buyNowData:    { productId, variantId, quantity: parseInt(quantity) },
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /buy-now/place-order
// ═══════════════════════════════════════════════════════════════════════════════
export const placeBuyNowOrder = asyncHandler(async (req, res) => {
  const userId = req.session.user.id;
  const { addressId, paymentMethod, productId, variantId, quantity } = req.body;

  if (!addressId || !paymentMethod || !productId || !variantId || !quantity)
    return res.status(400).json({ success: false, message: 'All fields are required' });

  if (paymentMethod !== 'cod')
    return res.status(400).json({ success: false, message: 'Only COD is supported for Buy Now' });

  const validation = await validateCheckoutService(userId, addressId, [{
    productId, variantId, quantity: parseInt(quantity),
  }]);
  if (!validation.success) return res.status(400).json(validation);

  const result = await processCheckoutService({
    userId, addressId, paymentMethod: 'cod',
    items: [{ productId, variantId, quantity: parseInt(quantity) }],
    isBuyNow: true,
  });

  if (result.success) {
    return res.json({
      success:     true,
      message:     result.message,
      orderId:     result.order._id,
      orderNumber: result.order.orderNumber,
      redirect:    `/orders/${result.order._id}`,
    });
  }

  return res.status(400).json(result);
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /orders/:orderId  — order confirmation page
// ═══════════════════════════════════════════════════════════════════════════════
export const getOrderConfirmation = asyncHandler(async (req, res) => {
  const userId   = req.session.user.id;
  const { orderId } = req.params;

  const result = await getOrderByIdService(orderId, userId);
  if (!result.success) {
    return res.status(404).render('error', { message: 'Order not found', layout: 'layouts/user' });
  }

  res.render('user/order-confirmation', {
    layout: 'layouts/user',
    path:   'orders',
    order:  result.order,
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /orders/:orderId/invoice
// ═══════════════════════════════════════════════════════════════════════════════
export const downloadInvoice = asyncHandler(async (req, res) => {
  const userId      = req.session.user.id;
  const { orderId } = req.params;

  const result = await getOrderByIdService(orderId, userId);
  if (!result.success)
    return res.status(404).json({ success: false, message: 'Order not found' });

  const { order } = result;

  if (order.status !== 'delivered')
    return res.status(400).json({ success: false, message: 'Invoice is only available for delivered orders' });

  const deliveredItems = order.items.filter(
    i => i.status !== 'cancelled' && i.returnStatus !== 'approved'
  );

  const subtotal = deliveredItems.reduce((sum, i) => sum + (i.itemTotal || i.basePrice * i.quantity || 0), 0);
  const shipping = subtotal >= 5000 ? 0 : 50;
  const tax      = Math.round(subtotal * 0.18);
  const total    = subtotal + shipping + tax;

  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=invoice-${order.orderNumber || orderId.slice(-8).toUpperCase()}.pdf`);
  doc.pipe(res);

  doc.rect(0, 0, 595, 120).fill('#05080d');
  doc.fillColor('#22d3ee').fontSize(26).font('Helvetica-Bold').text('NEO LUXE', 50, 35);
  doc.fillColor('#94a3b8').fontSize(10).font('Helvetica').text('Premium Watch Collection', 50, 65);
  doc.fillColor('#ffffff').fontSize(22).font('Helvetica-Bold').text('INVOICE', 430, 40);
  doc.fillColor('#22d3ee').fontSize(10).font('Helvetica').text(`#${order.orderNumber || orderId.slice(-8).toUpperCase()}`, 430, 68);

  let y = 140;
  doc.fillColor('#1e293b').rect(50, y, 495, 1).fill(); y += 15;
  doc.fillColor('#64748b').fontSize(8).font('Helvetica-Bold').text('ORDER DATE', 50, y);
  doc.fillColor('#64748b').fontSize(8).font('Helvetica-Bold').text('PAYMENT METHOD', 220, y);
  doc.fillColor('#64748b').fontSize(8).font('Helvetica-Bold').text('STATUS', 390, y);
  y += 14;
  doc.fillColor('#0f172a').fontSize(10).font('Helvetica').text(
    new Date(order.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }), 50, y);
  doc.fillColor('#0f172a').fontSize(10).font('Helvetica').text(
    order.paymentMethod === 'cod' ? 'Cash on Delivery'
    : order.paymentMethod === 'razorpay' ? 'Razorpay' : 'Online Payment', 220, y);
  doc.fillColor('#16a34a').fontSize(10).font('Helvetica-Bold').text('DELIVERED', 390, y);
  y += 30;

  doc.fillColor('#1e293b').rect(50, y, 495, 1).fill(); y += 20;
  doc.fillColor('#64748b').fontSize(8).font('Helvetica-Bold').text('BILL TO', 50, y); y += 14;
  doc.fillColor('#0f172a').fontSize(11).font('Helvetica-Bold').text(order.shippingAddress.fullName, 50, y); y += 16;
  const addr = [
    order.shippingAddress.addressLine1,
    order.shippingAddress.addressLine2,
    `${order.shippingAddress.city}, ${order.shippingAddress.state} ${order.shippingAddress.pincode}`,
  ].filter(Boolean).join(', ');
  doc.fillColor('#334155').fontSize(10).font('Helvetica').text(addr, 50, y, { width: 250 });
  y += doc.heightOfString(addr, { width: 250 }) + 6;
  doc.fillColor('#334155').fontSize(10).text(`Phone: ${order.shippingAddress.phone}`, 50, y); y += 30;

  doc.fillColor('#0f172a').rect(50, y, 495, 28).fill();
  doc.fillColor('#ffffff').fontSize(9).font('Helvetica-Bold');
  doc.text('ITEM', 60, y + 9);
  doc.text('COLOR', 290, y + 9);
  doc.text('QTY', 360, y + 9, { width: 40, align: 'center' });
  doc.text('UNIT PRICE', 410, y + 9, { width: 70, align: 'right' });
  doc.text('TOTAL', 490, y + 9, { width: 55, align: 'right' });
  y += 28;

  deliveredItems.forEach((item, idx) => {
    const rowBg     = idx % 2 === 0 ? '#f8fafc' : '#f1f5f9';
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
  const totalsX = 370, valX = 490, valW = 55;
  doc.fillColor('#e2e8f0').rect(totalsX, y, 175, 1).fill(); y += 12;
  doc.fillColor('#64748b').fontSize(9).font('Helvetica').text('Subtotal', totalsX, y);
  doc.fillColor('#0f172a').fontSize(9).font('Helvetica').text(`Rs.${subtotal.toLocaleString('en-IN')}`, valX, y, { width: valW, align: 'right' }); y += 16;
  doc.fillColor('#64748b').fontSize(9).font('Helvetica').text('Shipping', totalsX, y);
  doc.fillColor(shipping === 0 ? '#16a34a' : '#0f172a').fontSize(9).font('Helvetica').text(shipping === 0 ? 'FREE' : `Rs.${shipping}`, valX, y, { width: valW, align: 'right' }); y += 16;
  doc.fillColor('#64748b').fontSize(9).font('Helvetica').text('Tax (18% GST)', totalsX, y);
  doc.fillColor('#0f172a').fontSize(9).font('Helvetica').text(`Rs.${tax.toLocaleString('en-IN')}`, valX, y, { width: valW, align: 'right' }); y += 12;
  doc.fillColor('#e2e8f0').rect(totalsX, y, 175, 1).fill(); y += 12;
  doc.fillColor('#0f172a').rect(totalsX - 5, y - 4, 185, 28).fill();
  doc.fillColor('#ffffff').fontSize(11).font('Helvetica-Bold').text('TOTAL', totalsX, y + 4);
  doc.fillColor('#22d3ee').fontSize(13).font('Helvetica-Bold').text(`Rs.${total.toLocaleString('en-IN')}`, valX - 10, y + 3, { width: valW + 10, align: 'right' });
  y += 40;

  doc.fillColor('#e2e8f0').rect(50, y, 495, 1).fill(); y += 15;
  doc.fillColor('#94a3b8').fontSize(8).font('Helvetica')
     .text('Thank you for shopping with Neo Luxe. For support, contact us at support@neoluxe.com', 50, y, { align: 'center', width: 495 });
  y += 14;
  doc.fillColor('#cbd5e1').fontSize(7).font('Helvetica')
     .text('This is a computer-generated invoice and does not require a signature.', 50, y, { align: 'center', width: 495 });

  doc.end();
});
