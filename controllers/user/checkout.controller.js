import mongoose from 'mongoose';
import asyncHandler from '../../utils/asyncHandler.util.js';
import Cart from '../../models/cart.model.js';
import Variant from '../../models/variant.model.js';
import Product from '../../models/product.model.js';
import Category from '../../models/category.model.js';
import Address from '../../models/address.model.js';
import Order from '../../models/order.model.js';
import PDFDocument from 'pdfkit';

const MAX_QTY = 10;

// ─── Shared: validate cart items against live stock/availability ─────────────
// Returns { validItems, blockedItems, stockErrors }
// validItems  → items that passed all checks (with live variant attached)
// blockedItems → items that are unavailable (deleted, unlisted, OOS)
// stockErrors  → items where requested qty > current stock (qty clamped)
async function validateCartItems(cartItems) {
  const validItems   = [];
  const blockedItems = [];
  const stockErrors  = [];

  for (const item of cartItems) {
    const product  = await Product.findById(item.product).populate('category').lean();
    const variant  = await Variant.findById(item.variant).lean();
    const category = product?.category;

    // Hard unavailable — remove from consideration
    if (!product || product.isDeleted || !variant || variant.isDeleted || !category) {
      blockedItems.push({ item, reason: 'Product no longer exists' });
      continue;
    }
    if (!product.isActive) {
      blockedItems.push({ item, reason: `"${product.name}" is currently unlisted` });
      continue;
    }
    if (!category.isListed) {
      blockedItems.push({ item, reason: `Category "${category.name}" is unlisted` });
      continue;
    }
    if (!variant.isActive) {
      blockedItems.push({ item, reason: `A variant of "${product.name}" is unavailable` });
      continue;
    }
    if (variant.stock === 0) {
      blockedItems.push({ item, reason: `"${product.name}" is out of stock` });
      continue;
    }

    // Stock quantity check
    let qty = item.quantity;
    if (qty > variant.stock) {
      stockErrors.push({
        name:      product.name,
        requested: qty,
        available: variant.stock,
      });
      qty = variant.stock; // clamp to available
    }
    if (qty > MAX_QTY) qty = MAX_QTY;

    validItems.push({ item, product, variant, category, qty });
  }

  return { validItems, blockedItems, stockErrors };
}

// ─── Helper: compute order totals ────────────────────────────────────────────
function calcTotals(validItems) {
  const subtotal = validItems.reduce((sum, { variant, qty }) => sum + variant.basePrice * qty, 0);
  const shipping = subtotal >= 5000 ? 0 : 50;
  const tax      = Math.round(subtotal * 0.18);
  const total    = subtotal + tax + shipping;
  return { subtotal, shipping, tax, total };
}

// ─── GET /checkout ────────────────────────────────────────────────────────────
// Shows checkout page with live-validated cart items and saved addresses
export const getCheckout = asyncHandler(async (req, res) => {
  const userId = req.session.user.id;

  const cart = await Cart.findOne({ user: userId }).lean();

  if (!cart || cart.items.length === 0) {
    return res.redirect('/cart');
  }

  const { validItems, blockedItems, stockErrors } = await validateCartItems(cart.items);

  // If nothing is purchasable, send back to cart
  if (validItems.length === 0) {
    req.session.cartFlash = 'All items in your cart are currently unavailable.';
    return res.redirect('/cart');
  }

  const totals    = calcTotals(validItems);
  const addresses = await Address.find({ userId }).lean();

  const checkoutItems = validItems.map(({ item, product, variant, qty }) => ({
    productId:    product._id,
    variantId:    variant._id,
    productName:  product.name,
    brand:        product.brand,
    color:        variant.color,
    imageUrl:     variant.images?.[0]?.url || '',
    basePrice:    variant.basePrice,
    regularPrice: variant.regularPrice,
    stock:        variant.stock,
    quantity:     qty,
    itemTotal:    variant.basePrice * qty,
  }));

  res.render('user/checkout', {
    layout:       'layouts/user',
    checkoutItems,
    blockedItems: blockedItems.map(b => b.reason),
    stockErrors,
    addresses,
    totals,
  });
});

// ─── POST /checkout/place-order ───────────────────────────────────────────────
// Final stock re-validation + atomic stock deduction + order creation
export const placeOrder = asyncHandler(async (req, res) => {
  const userId = req.session.user.id;
  const { addressId, paymentMethod = 'cod' } = req.body;

  // 1. Validate address
  if (!addressId || !mongoose.Types.ObjectId.isValid(addressId)) {
    return res.status(400).json({ success: false, message: 'Please select a delivery address.' });
  }
  const address = await Address.findOne({ _id: addressId, userId }).lean();
  if (!address) {
    return res.status(400).json({ success: false, message: 'Selected address not found.' });
  }

  // 2. Load cart
  const cart = await Cart.findOne({ user: userId }).lean();
  if (!cart || cart.items.length === 0) {
    return res.status(400).json({ success: false, message: 'Your cart is empty.' });
  }

  // 3. Re-validate every item against live stock (race-condition safe)
  const { validItems, blockedItems, stockErrors } = await validateCartItems(cart.items);

  if (validItems.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'All items in your cart are currently unavailable. Please review your cart.',
      redirect: '/cart',
    });
  }

  if (blockedItems.length > 0) {
    const names = blockedItems.map(b => b.reason).join('; ');
    return res.status(400).json({
      success: false,
      message: `Some items are unavailable: ${names}. Please remove them from your cart before ordering.`,
      redirect: '/cart',
    });
  }

  // 4. Atomically deduct stock for each variant
  //    Use findOneAndUpdate with $gte guard to prevent overselling
  const deducted = [];
  try {
    for (const { variant, qty } of validItems) {
      const updated = await Variant.findOneAndUpdate(
        { _id: variant._id, stock: { $gte: qty } }, // guard: only update if stock is still sufficient
        { $inc: { stock: -qty } },
        { new: true }
      );

      if (!updated) {
        // Stock dropped between validation and deduction — roll back already-deducted items
        for (const { variantId, qty: dQty } of deducted) {
          await Variant.findByIdAndUpdate(variantId, { $inc: { stock: dQty } });
        }
        return res.status(409).json({
          success: false,
          message: `Stock for one or more items changed just before your order was placed. Please review your cart.`,
          redirect: '/cart',
        });
      }

      deducted.push({ variantId: variant._id, qty });
    }
  } catch (err) {
    // Roll back any successful deductions on unexpected error
    for (const { variantId, qty: dQty } of deducted) {
      await Variant.findByIdAndUpdate(variantId, { $inc: { stock: dQty } });
    }
    throw err;
  }

  // 5. Build order document
  const totals = calcTotals(validItems);

  const orderItems = validItems.map(({ product, variant, qty }) => ({
    product:      product._id,
    variant:      variant._id,
    productName:  product.name,
    variantColor: variant.color,
    imageUrl:     variant.images?.[0]?.url || '',
    basePrice:    variant.basePrice,
    regularPrice: variant.regularPrice,
    quantity:     qty,
    itemTotal:    variant.basePrice * qty,
  }));

  const order = await Order.create({
    user: userId,
    items: orderItems,
    ...totals,
    shippingAddress: {
      fullName:     address.fullName,
      phone:        address.phone,
      addressLine1: address.streetAddress,
      city:         address.city,
      state:        address.state,
      pincode:      address.pincode,
    },
    paymentMethod,
    paymentStatus: paymentMethod === 'cod' ? 'pending' : 'pending',
    status: 'confirmed',
  });

  // 6. Clear cart (only the items that were ordered)
  const orderedVariantIds = new Set(validItems.map(({ variant }) => variant._id.toString()));
  await Cart.findOneAndUpdate(
    { user: userId },
    { $pull: { items: { variant: { $in: [...orderedVariantIds] } } } }
  );

  return res.json({
    success:  true,
    message:  'Order placed successfully!',
    orderId:  order._id,
    redirect: `/orders/${order._id}`,
  });
});

// ─── POST /checkout/buy-now ───────────────────────────────────────────────────
// Single-item express checkout — validates availability then shows checkout page
export const buyNow = asyncHandler(async (req, res) => {
  const userId = req.session?.user?.id;
  if (!userId) {
    // AJAX request — return JSON so the frontend can redirect to login
    return res.status(401).json({ success: false, message: 'Please login to continue.', redirect: '/login' });
  }

  const { productId, variantId } = req.body;

  const product  = await Product.findById(productId).populate('category').lean();
  const variant  = await Variant.findById(variantId).lean();
  const category = product?.category;

  // All failures return JSON — no redirects — so the page stays in place
  if (!product || product.isDeleted) {
    return res.status(404).json({ success: false, message: 'This product no longer exists.' });
  }
  if (!product.isActive) {
    return res.status(400).json({ success: false, message: 'This product has been unlisted by the store.' });
  }
  if (!category || !category.isListed) {
    return res.status(400).json({ success: false, message: 'This product\'s category is currently unavailable.' });
  }
  if (!variant || variant.isDeleted) {
    return res.status(404).json({ success: false, message: 'This variant no longer exists.' });
  }
  if (!variant.isActive) {
    return res.status(400).json({ success: false, message: 'This variant is currently unavailable.' });
  }
  if (variant.stock === 0) {
    return res.status(400).json({ success: false, message: 'This item is out of stock.' });
  }

  const addresses = await Address.find({ userId }).lean();

  const checkoutItems = [{
    productId:    product._id,
    variantId:    variant._id,
    productName:  product.name,
    brand:        product.brand,
    color:        variant.color,
    imageUrl:     variant.images?.[0]?.url || '',
    basePrice:    variant.basePrice,
    regularPrice: variant.regularPrice,
    stock:        variant.stock,
    quantity:     1,
    itemTotal:    variant.basePrice,
  }];

  const subtotal = variant.basePrice;
  const shipping = subtotal >= 5000 ? 0 : 50;
  const tax      = Math.round(subtotal * 0.18);
  const totals   = { subtotal, shipping, tax, total: subtotal + tax + shipping };

  // Render the checkout page directly — success path stays server-rendered
  return res.render('user/checkout', {
    layout:          'layouts/user',
    checkoutItems,
    blockedItems:    [],
    stockErrors:     [],
    addresses,
    totals,
    isBuyNow:        true,
    buyNowProductId: productId,
    buyNowVariantId: variantId,
  });
});

// ─── GET /orders/:orderId ─────────────────────────────────────────────────────
export const getOrderConfirmation = asyncHandler(async (req, res) => {
  const userId  = req.session.user.id;
  const { orderId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(orderId)) {
    return res.redirect('/profile');
  }

  const order = await Order.findOne({ _id: orderId, user: userId }).lean();
  if (!order) {
    return res.redirect('/profile');
  }

  res.render('user/order-confirmation', {
    layout: false,
    order,
  });
});

// ─── GET /orders ──────────────────────────────────────────────────────────────
export const getOrders = asyncHandler(async (req, res) => {
  const userId = req.session.user.id;
  const LIMIT  = 3;
  const page   = Math.max(1, parseInt(req.query.page) || 1);
  const skip   = (page - 1) * LIMIT;

  const [orders, total] = await Promise.all([
    Order.find({ user: userId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(LIMIT)
      .lean(),
    Order.countDocuments({ user: userId }),
  ]);

  const totalPages = Math.ceil(total / LIMIT);

  res.locals.activePage = 'orders';

  res.render('user/orders', {
    layout: 'layouts/user',
    orders,
    user:        res.locals.user,
    currentPage: page,
    totalPages,
    total,
  });
});

// ─── GET /orders/:orderId/details ─────────────────────────────────────────────
export const getOrderDetails = asyncHandler(async (req, res) => {
  const userId  = req.session.user.id;
  const { orderId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(orderId)) {
    return res.redirect('/orders');
  }

  const order = await Order.findOne({ _id: orderId, user: userId }).lean();
  if (!order) {
    return res.redirect('/orders');
  }

  // Ensure items array exists (fallback for data integrity)
  if (!order.items) {
    order.items = [];
  }

  res.locals.activePage = 'orders';
  res.render('user/order-details', {
    layout: false,
    order,
  });
});

// ─── POST /orders/:orderId/cancel ─────────────────────────────────────────────
// Cancel entire order — restores stock for all items
export const cancelOrder = asyncHandler(async (req, res) => {
  const userId  = req.session.user.id;
  const { orderId } = req.params;
  const { reason = '' } = req.body;

  if (!mongoose.Types.ObjectId.isValid(orderId)) {
    return res.status(400).json({ success: false, message: 'Invalid order ID.' });
  }

  const order = await Order.findOne({ _id: orderId, user: userId });
  if (!order) {
    return res.status(404).json({ success: false, message: 'Order not found.' });
  }

  const cancellableStatuses = ['pending', 'confirmed', 'processing'];
  if (!cancellableStatuses.includes(order.status)) {
    return res.status(400).json({
      success: false,
      message: `Order cannot be cancelled at this stage (current status: ${order.status}).`,
    });
  }

  // Restore stock only for active (non-cancelled) items
  for (const item of order.items) {
    if (item.status !== 'cancelled') {
      await Variant.findByIdAndUpdate(item.variant, { $inc: { stock: item.quantity } });
    }
  }

  // Mark all active items as cancelled
  order.items.forEach((item, i) => {
    if (item.status !== 'cancelled') {
      order.items[i].status = 'cancelled';
    }
  });

  order.status        = 'cancelled';
  order.cancelReason  = reason.trim();
  order.paymentStatus = 'cancelled';
  await order.save();

  return res.json({ success: true, message: 'Order cancelled successfully.' });
});

// ─── POST /orders/:orderId/return ─────────────────────────────────────────────
// Request return for a delivered order (reason is mandatory)
export const returnOrder = asyncHandler(async (req, res) => {
  const userId  = req.session.user.id;
  const { orderId } = req.params;
  const { reason = '' } = req.body;

  if (!mongoose.Types.ObjectId.isValid(orderId)) {
    return res.status(400).json({ success: false, message: 'Invalid order ID.' });
  }

  if (!reason.trim()) {
    return res.status(400).json({ success: false, message: 'A reason is required to request a return.' });
  }

  const order = await Order.findOne({ _id: orderId, user: userId });
  if (!order) {
    return res.status(404).json({ success: false, message: 'Order not found.' });
  }

  if (order.status !== 'delivered') {
    return res.status(400).json({
      success: false,
      message: 'Only delivered orders can be returned.',
    });
  }

  // Mark all active (non-cancelled) items as return requested
  order.items.forEach((item, i) => {
    if (item.status !== 'cancelled' && item.returnStatus === 'none') {
      order.items[i].returnStatus = 'requested';
      order.items[i].returnReason = reason.trim();
    }
  });

  order.status       = 'returned';
  order.cancelReason = reason.trim();
  await order.save();

  return res.json({ success: true, message: 'Return request submitted successfully.' });
});

// ─── POST /orders/:orderId/items/:itemIndex/return ────────────────────────────
// Request return for a single delivered item (reason is mandatory).
// Order-level status stays 'delivered' until every active item has a return
// request — only then does it flip to 'returned'.
export const returnOrderItem = asyncHandler(async (req, res) => {
  const userId  = req.session.user.id;
  const { orderId, itemIndex } = req.params;
  const { reason = '' } = req.body;
  const idx = parseInt(itemIndex, 10);

  if (!mongoose.Types.ObjectId.isValid(orderId) || isNaN(idx)) {
    return res.status(400).json({ success: false, message: 'Invalid request.' });
  }

  if (!reason.trim()) {
    return res.status(400).json({ success: false, message: 'A reason is required to request a return.' });
  }

  const order = await Order.findOne({ _id: orderId, user: userId });
  if (!order) {
    return res.status(404).json({ success: false, message: 'Order not found.' });
  }

  // Allow item-level returns as long as the order is delivered or partially returned
  if (order.status !== 'delivered' && order.status !== 'returned') {
    return res.status(400).json({ success: false, message: 'Only delivered orders can be returned.' });
  }

  if (idx < 0 || idx >= order.items.length) {
    return res.status(400).json({ success: false, message: 'Item not found in order.' });
  }

  const item = order.items[idx];

  if (item.status === 'cancelled') {
    return res.status(400).json({ success: false, message: 'Cancelled items cannot be returned.' });
  }
  if (item.returnStatus !== 'none') {
    return res.status(400).json({ success: false, message: 'A return has already been requested for this item.' });
  }

  // Update only this item's return status
  order.items[idx].returnStatus = 'requested';
  order.items[idx].returnReason = reason.trim();

  // Flip order-level status to 'returned' ONLY when every active item
  // (not cancelled) now has a return request — i.e. this was the last one
  const activeItems  = order.items.filter(i => i.status !== 'cancelled');
  const allRequested = activeItems.every(i => i.returnStatus !== 'none');
  if (allRequested) {
    order.status       = 'returned';
    order.cancelReason = reason.trim();
  }

  await order.save();
  return res.json({ success: true, message: 'Return request submitted for this item.' });
});

// ─── POST /orders/:orderId/items/:itemIndex/cancel ────────────────────────────
// Cancel a single item within an order — restores that item's stock
export const cancelOrderItem = asyncHandler(async (req, res) => {
  const userId    = req.session.user.id;
  const { orderId, itemIndex } = req.params;
  const idx = parseInt(itemIndex, 10);

  if (!mongoose.Types.ObjectId.isValid(orderId) || isNaN(idx)) {
    return res.status(400).json({ success: false, message: 'Invalid request.' });
  }

  const order = await Order.findOne({ _id: orderId, user: userId });
  if (!order) {
    return res.status(404).json({ success: false, message: 'Order not found.' });
  }

  const cancellableStatuses = ['pending', 'confirmed', 'processing'];
  if (!cancellableStatuses.includes(order.status)) {
    return res.status(400).json({
      success: false,
      message: `Items cannot be cancelled at this stage (current status: ${order.status}).`,
    });
  }

  if (idx < 0 || idx >= order.items.length) {
    return res.status(400).json({ success: false, message: 'Item not found in order.' });
  }

  const item = order.items[idx];

  if (item.status === 'cancelled') {
    return res.status(400).json({ success: false, message: 'Item is already cancelled.' });
  }

  // Restore stock for this item
  await Variant.findByIdAndUpdate(item.variant, { $inc: { stock: item.quantity } });

  // Mark item as cancelled — DO NOT remove it so it stays visible in order history
  order.items[idx].status = 'cancelled';

  // Check if all items are now cancelled
  const activeItems = order.items.filter(i => i.status !== 'cancelled');

  if (activeItems.length === 0) {
    // All items cancelled — cancel the whole order
    order.status        = 'cancelled';
    order.cancelReason  = 'All items cancelled by customer';
    // COD: no money collected before shipment, mark payment as cancelled
    order.paymentStatus = 'cancelled';
  } else {
    // Recalculate totals based on active items only
    const subtotal  = activeItems.reduce((sum, i) => sum + i.itemTotal, 0);
    const shipping  = subtotal >= 5000 ? 0 : 50;
    const tax       = Math.round(subtotal * 0.18);
    order.subtotal  = subtotal;
    order.shipping  = shipping;
    order.tax       = tax;
    order.total     = subtotal + shipping + tax;
  }

  await order.save();

  return res.json({ success: true, message: 'Item cancelled successfully.' });
});

// ─── GET /payment-failed ──────────────────────────────────────────────────────
export const getPaymentFailed = asyncHandler(async (req, res) => {
  const { orderId, amount, paymentMethod } = req.query;
  res.render('user/payment-failed', {
    layout: false,
    orderId:       orderId || null,
    amount:        amount  || null,
    paymentMethod: paymentMethod || null,
  });
});
// Generate and stream a PDF invoice for the order
export const downloadInvoice = asyncHandler(async (req, res) => {
  const userId  = req.session.user.id;
  const { orderId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(orderId)) {
    return res.status(400).json({ success: false, message: 'Invalid order ID.' });
  }

  const order = await Order.findOne({ _id: orderId, user: userId }).lean();
  if (!order) {
    return res.status(404).json({ success: false, message: 'Order not found.' });
  }

  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  const filename = `invoice-${order._id}.pdf`;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  doc.pipe(res);

  // ── Filter to billable items only ────────────────────────────────────
  // Cancelled items were never charged; approved returns were refunded.
  // Neither should appear on the invoice.
  const billableItems = order.items.filter(
    item => item.status !== 'cancelled' && item.returnStatus !== 'approved'
  );

  // Recalculate totals from billable items so the invoice always matches
  // what was actually charged, regardless of stored order totals.
  const invoiceSubtotal = billableItems.reduce((sum, item) => sum + item.itemTotal, 0);
  const invoiceShipping = invoiceSubtotal >= 5000 ? 0 : 50;
  const invoiceTax      = Math.round(invoiceSubtotal * 0.18);
  const invoiceTotal    = invoiceSubtotal + invoiceShipping + invoiceTax;

  // ── Header ──────────────────────────────────────────────────────────
  doc.fontSize(22).font('Helvetica-Bold').text('NEO-LUXE', 50, 50);
  doc.fontSize(10).font('Helvetica').fillColor('#666').text('Premium Timepieces', 50, 76);

  doc.fillColor('#000').fontSize(18).font('Helvetica-Bold').text('INVOICE', 400, 50, { align: 'right' });
  doc.fontSize(10).font('Helvetica').fillColor('#666')
    .text(`Order #${order.orderId || order._id.toString().slice(-8).toUpperCase()}`, 400, 76, { align: 'right' })
    .text(`Date: ${new Date(order.createdAt).toLocaleDateString('en-IN', { day:'numeric', month:'long', year:'numeric' })}`, 400, 90, { align: 'right' });

  // ── Divider ──────────────────────────────────────────────────────────
  doc.moveTo(50, 115).lineTo(545, 115).strokeColor('#e5e7eb').stroke();

  // ── Billing / Shipping ───────────────────────────────────────────────
  doc.fillColor('#000').fontSize(11).font('Helvetica-Bold').text('SHIP TO', 50, 130);
  doc.fontSize(10).font('Helvetica').fillColor('#333')
    .text(order.shippingAddress.fullName || '', 50, 148)
    .text(order.shippingAddress.addressLine1 || '', 50, 162)
    .text(`${order.shippingAddress.city}, ${order.shippingAddress.state} - ${order.shippingAddress.pincode}`, 50, 176)
    .text(`Phone: ${order.shippingAddress.phone}`, 50, 190);

  doc.fillColor('#000').fontSize(11).font('Helvetica-Bold').text('PAYMENT', 350, 130);
  doc.fontSize(10).font('Helvetica').fillColor('#333')
    .text(`Method: ${order.paymentMethod === 'cod' ? 'Cash on Delivery' : 'Online'}`, 350, 148);

  // Human-readable payment status for the invoice
  const payStatusLabel = {
    pending:   'Pending Collection',
    paid:      'Paid',
    failed:    'Failed',
    refunded:  'Refunded',
    cancelled: 'Cancelled (Not Charged)',
  };
  doc.text(`Status: ${payStatusLabel[order.paymentStatus] || order.paymentStatus}`, 350, 162);

  // ── Items table ──────────────────────────────────────────────────────
  let y = 230;
  doc.moveTo(50, y - 10).lineTo(545, y - 10).strokeColor('#e5e7eb').stroke();

  doc.fillColor('#000').fontSize(10).font('Helvetica-Bold')
    .text('ITEM', 50, y)
    .text('COLOR', 280, y)
    .text('QTY', 360, y)
    .text('UNIT PRICE', 410, y)
    .text('TOTAL', 490, y);

  y += 18;
  doc.moveTo(50, y).lineTo(545, y).strokeColor('#e5e7eb').stroke();
  y += 10;

  doc.font('Helvetica').fillColor('#333').fontSize(10);
  for (const item of billableItems) {
    doc.text(item.productName, 50, y, { width: 220 })
       .text(item.variantColor || '—', 280, y)
       .text(String(item.quantity), 360, y)
       .text(`Rs.${item.basePrice.toLocaleString('en-IN')}`, 410, y)
       .text(`Rs.${item.itemTotal.toLocaleString('en-IN')}`, 490, y);
    y += 22;
    if (y > 700) { doc.addPage(); y = 50; }
  }

  // ── Totals ───────────────────────────────────────────────────────────
  y += 10;
  doc.moveTo(350, y).lineTo(545, y).strokeColor('#e5e7eb').stroke();
  y += 12;

  const totalsRows = [
    ['Subtotal',  `Rs.${invoiceSubtotal.toLocaleString('en-IN')}`],
    ['Shipping',  invoiceShipping === 0 ? 'Free' : `Rs.${invoiceShipping.toLocaleString('en-IN')}`],
    ['Tax (GST)', `Rs.${invoiceTax.toLocaleString('en-IN')}`],
  ];
  for (const [label, value] of totalsRows) {
    doc.font('Helvetica').fillColor('#555').fontSize(10)
       .text(label, 350, y)
       .text(value, 490, y);
    y += 18;
  }

  y += 4;
  doc.moveTo(350, y).lineTo(545, y).strokeColor('#000').lineWidth(1).stroke();
  y += 10;
  doc.font('Helvetica-Bold').fillColor('#000').fontSize(12)
     .text('TOTAL', 350, y)
     .text(`Rs.${invoiceTotal.toLocaleString('en-IN')}`, 490, y);

  // ── Footer ───────────────────────────────────────────────────────────
  doc.fontSize(9).font('Helvetica').fillColor('#999')
     .text('Thank you for shopping with Neo-Luxe. For support, contact support@neoluxe.com', 50, 760, { align: 'center', width: 495 });

  doc.end();
});

