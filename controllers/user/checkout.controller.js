import mongoose from 'mongoose';
import asyncHandler from '../../utils/asyncHandler.util.js';
import Cart from '../../models/cart.model.js';
import Variant from '../../models/variant.model.js';
import Product from '../../models/product.model.js';
import Category from '../../models/category.model.js';
import Address from '../../models/address.model.js';
import Order from '../../models/order.model.js';

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
// Single-item express checkout — validates stock then shows checkout page
export const buyNow = asyncHandler(async (req, res) => {
  const userId = req.session?.user?.id;
  if (!userId) return res.redirect('/login');

  const { productId, variantId } = req.body;

  const product  = await Product.findById(productId).populate('category').lean();
  const variant  = await Variant.findById(variantId).lean();
  const category = product?.category;

  // Availability checks
  if (!product || product.isDeleted || !product.isActive) {
    return res.redirect('/shop');
  }
  if (!category || !category.isListed) {
    return res.redirect('/shop');
  }
  if (!variant || variant.isDeleted || !variant.isActive) {
    return res.redirect(`/shop/${productId}`);
  }
  if (variant.stock === 0) {
    return res.redirect(`/shop/${productId}?error=out_of_stock`);
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

  res.render('user/checkout', {
    layout:       'layouts/user',
    checkoutItems,
    blockedItems: [],
    stockErrors:  [],
    addresses,
    totals,
    isBuyNow:     true,
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
    layout: 'layouts/user',
    order,
  });
});

// ─── GET /orders ──────────────────────────────────────────────────────────────
export const getOrders = asyncHandler(async (req, res) => {
  const userId = req.session.user.id;

  const orders = await Order.find({ user: userId })
    .sort({ createdAt: -1 })
    .lean();

  res.render('user/orders', {
    layout: 'layouts/user',
    orders,
  });
});
