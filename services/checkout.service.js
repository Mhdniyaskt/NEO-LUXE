import Cart from '../models/cart.model.js';
import Variant from '../models/variant.model.js';
import Product from '../models/product.model.js';
import Address from '../models/address.model.js';
import Order from '../models/order.model.js';
import Coupon from '../models/coupon.model.js';
import { MESSAGES } from '../constants/messages.constant.js';
import { debitWalletService } from './wallet.service.js';
import { calculateOfferPrice } from '../utils/offerPrice.util.js';
import { calcOrderTotals, calcSubtotal } from '../utils/orderCalc.util.js';

const MAX_QTY = 10;

// ─── Validate cart items against live stock/availability ─────────────────────
async function validateCartItems(cartItems) {
  const validItems   = [];
  const blockedItems = [];
  const stockErrors  = [];

  for (const item of cartItems) {
    const productId = item.product?._id || item.product;
    const variantId = item.variant?._id || item.variant;

    const product  = await Product.findById(productId).populate('category').lean();
    const variant  = await Variant.findById(variantId).lean();
    const category = product?.category;

    if (!product || product.isDeleted || !variant || variant.isDeleted || !category) {
      blockedItems.push({ item, reason: 'Product no longer exists' }); continue;
    }
    if (!product.isActive) {
      blockedItems.push({ item, reason: `"${product.name}" is currently unlisted` }); continue;
    }
    if (!category.isListed) {
      blockedItems.push({ item, reason: `Category "${category.name}" is unlisted` }); continue;
    }
    if (!variant.isActive) {
      blockedItems.push({ item, reason: `A variant of "${product.name}" is unavailable` }); continue;
    }
    if (variant.stock === 0) {
      blockedItems.push({ item, reason: `"${product.name}" is out of stock` }); continue;
    }

    let qty = item.quantity;
    if (qty > variant.stock) {
      stockErrors.push({ name: product.name, requested: qty, available: variant.stock });
      qty = variant.stock;
    }
    if (qty > MAX_QTY) qty = MAX_QTY;

    validItems.push({ item, product, variant, category, qty });
  }

  return { validItems, blockedItems, stockErrors };
}

// ─── Resolve a coupon code → verified discount amount ────────────────────────
// Returns { discountAmount, couponId, couponCode } or throws on invalid coupon.
// Does NOT increment usedCount — that happens only when the order is saved.
async function resolveCoupon(code, subtotal) {
  if (!code) return { discountAmount: 0, couponId: null, couponCode: null };

  const coupon = await Coupon.findOne({
    code:       code.trim().toUpperCase(),
    status:     'active',
    expiryDate: { $gt: new Date() },
  });

  if (!coupon)                          throw new Error('Invalid or expired coupon');
  if (coupon.usedCount >= coupon.usageLimit) throw new Error('Coupon usage limit reached');

  // minSpend check uses the pre-tax subtotal (product value only)
  if (subtotal < coupon.minSpend)
    throw new Error(`Minimum order of ₹${coupon.minSpend} required to use this coupon`);

  // Discount % applied to subtotal, capped at maxCap
  let discountAmount = (subtotal * coupon.discount) / 100;
  if (coupon.maxCap > 0 && discountAmount > coupon.maxCap) discountAmount = coupon.maxCap;

  return {
    discountAmount: Math.round(discountAmount),
    couponId:       coupon._id,
    couponCode:     coupon.code,
  };
}

// ─── Build orderItems array from validItems ───────────────────────────────────
function buildOrderItems(validItems) {
  return validItems.map(({ product, variant, category, qty }) => {
    const offerResult = calculateOfferPrice(variant, category, product);
    return {
      product:      product._id,
      variant:      variant._id,
      productName:  product.name,
      variantColor: variant.color,
      imageUrl:     variant.images?.[0]?.url || product.images?.[0]?.url || '',
      basePrice:    offerResult.finalPrice,
      regularPrice: variant.regularPrice ?? variant.basePrice,
      quantity:     qty,
      itemTotal:    offerResult.finalPrice * qty,
    };
  });
}

// ─── Get checkout page data ───────────────────────────────────────────────────
export const getCheckoutDataService = async (userId) => {
  try {
    const cart = await Cart.findOne({ user: userId })
      .populate({ path: 'items.product', populate: { path: 'category' } })
      .populate('items.variant');

    if (!cart || cart.items.length === 0)
      return { success: false, message: MESSAGES.CART.EMPTY };

    const { validItems, blockedItems, stockErrors } = await validateCartItems(cart.items);

    if (validItems.length === 0) {
      cart.items = [];
      await cart.save();
      return { success: false, message: MESSAGES.CHECKOUT.CART_UNAVAILABLE, blockedItems, stockErrors };
    }

    if (blockedItems.length > 0) {
      const validVariantIds = validItems.map(v => v.variant._id.toString());
      cart.items = cart.items.filter(item =>
        validVariantIds.includes((item.variant._id || item.variant).toString())
      );
      await cart.save();
    }

    // Use shared utility for totals
    const tempItems  = buildOrderItems(validItems);
    const subtotal   = calcSubtotal(tempItems);
    const totals     = calcOrderTotals(subtotal, 0);   // no coupon yet on page load
    const addresses  = await Address.find({ userId }).sort({ isDefault: -1, createdAt: -1 }).lean();

    const checkoutItems = validItems.map(({ product, variant, category, qty }) => {
      const offerResult = calculateOfferPrice(variant, category, product);
      return {
        productId:       product._id,
        variantId:       variant._id,
        productName:     product.name,
        brand:           product.brand,
        color:           variant.color,
        imageUrl:        variant.images?.[0]?.url || product.images?.[0]?.url || null,
        quantity:        qty,
        basePrice:       variant.basePrice,
        regularPrice:    variant.regularPrice ?? variant.basePrice,
        finalPrice:      offerResult.finalPrice,
        offerPercentage: offerResult.offerPercentage,
        offerSource:     offerResult.offerSource,
        itemTotal:       offerResult.finalPrice * qty,
      };
    });

    const availableCoupons = await Coupon.find({
      status:     'active',
      expiryDate: { $gt: new Date() },
      $expr:      { $lt: ['$usedCount', '$usageLimit'] },
    }).select('title code discount maxCap minSpend usageLimit usedCount expiryDate').lean();

    return {
      success: true,
      checkout: { items: checkoutItems, totals, addresses, coupons: availableCoupons, issues: { blockedItems, stockErrors } },
    };
  } catch (error) {
    console.error('getCheckoutDataService error:', error);
    return { success: false, message: MESSAGES.CHECKOUT.PREPARE_FAILED };
  }
};

// ─── Validate single product for buy now ─────────────────────────────────────
export const validateBuyNowService = async (productId, variantId, quantity = 1) => {
  try {
    quantity = Math.max(1, Math.min(MAX_QTY, parseInt(quantity) || 1));

    const product = await Product.findById(productId).populate('category');
    if (!product || product.isDeleted || !product.isActive)
      return { success: false, message: MESSAGES.PRODUCT.NOT_AVAILABLE };

    const variant = await Variant.findById(variantId);
    if (!variant || variant.isDeleted || !variant.isActive)
      return { success: false, message: MESSAGES.PRODUCT.VARIANT_UNAVAILABLE };

    if (!product.category || !product.category.isListed)
      return { success: false, message: MESSAGES.PRODUCT.CATEGORY_UNAVAILABLE };

    if (variant.stock === 0)
      return { success: false, message: MESSAGES.PRODUCT.OUT_OF_STOCK };

    if (quantity > variant.stock)
      return { success: false, message: `Only ${variant.stock} items available` };

    const offerResult = calculateOfferPrice(variant, product.category, product);
    const subtotal    = offerResult.finalPrice * quantity;
    const totals      = calcOrderTotals(subtotal, 0);

    return {
      success: true,
      buyNow: {
        item: {
          product: { _id: product._id, name: product.name, brand: product.brand, images: product.images },
          variant: {
            _id: variant._id, color: variant.color, basePrice: variant.basePrice,
            regularPrice: variant.regularPrice, finalPrice: offerResult.finalPrice,
            offerPercentage: offerResult.offerPercentage, offerSource: offerResult.offerSource,
            images: variant.images,
          },
          quantity,
          price:    offerResult.finalPrice,
          subtotal,
        },
        totals,
      },
    };
  } catch (error) {
    console.error('validateBuyNowService error:', error);
    return { success: false, message: MESSAGES.CHECKOUT.VALIDATE_FAILED };
  }
};

// ─── Validate checkout (address + cart/items) — no side effects ───────────────
export const validateCheckoutService = async (userId, addressId, items = null) => {
  try {
    const address = await Address.findOne({ _id: addressId, userId });
    if (!address) return { success: false, message: MESSAGES.CHECKOUT.INVALID_ADDRESS };

    if (items) {
      if (items.length !== 1) return { success: false, message: MESSAGES.CHECKOUT.BUY_NOW_ONE_ITEM };
      const { productId, variantId, quantity } = items[0];
      const product = await Product.findById(productId).populate('category');
      const variant = await Variant.findById(variantId);
      if (!product || product.isDeleted || !product.isActive)
        return { success: false, message: MESSAGES.PRODUCT.NOT_AVAILABLE };
      if (!variant || variant.isDeleted || !variant.isActive)
        return { success: false, message: MESSAGES.PRODUCT.VARIANT_UNAVAILABLE };
      if (variant.stock < quantity)
        return { success: false, message: `Insufficient stock. Available: ${variant.stock}` };
    } else {
      const cart = await Cart.findOne({ user: userId })
        .populate({ path: 'items.product', populate: { path: 'category' } })
        .populate('items.variant');

      if (!cart || cart.items.length === 0)
        return { success: false, message: MESSAGES.CART.EMPTY };

      const { validItems, blockedItems } = await validateCartItems(cart.items);

      if (validItems.length === 0)
        return { success: false, message: MESSAGES.CHECKOUT.CART_UNAVAILABLE,
                 blockedItems: blockedItems.map(b => b.reason) };

      if (blockedItems.length > 0)
        return { success: false, message: MESSAGES.CHECKOUT.ITEMS_UNAVAILABLE,
                 blockedItems: blockedItems.map(b => b.reason) };
    }

    return { success: true, message: MESSAGES.CHECKOUT.VALIDATION_PASSED };
  } catch (error) {
    console.error('validateCheckoutService error:', error);
    return { success: false, message: MESSAGES.CHECKOUT.VALIDATION_FAILED };
  }
};

// ─── Get cart totals for Razorpay order amount (NO side effects) ──────────────
export const getCartTotalsService = async (userId) => {
  try {
    const cart = await Cart.findOne({ user: userId })
      .populate({ path: 'items.product', populate: { path: 'category' } })
      .populate('items.variant');

    if (!cart || cart.items.length === 0)
      return { success: false, message: MESSAGES.CART.EMPTY };

    const { validItems, blockedItems } = await validateCartItems(cart.items);

    if (validItems.length === 0)
      return { success: false, message: MESSAGES.CHECKOUT.CART_UNAVAILABLE };

    if (blockedItems.length > 0)
      return { success: false, message: MESSAGES.CHECKOUT.ITEMS_UNAVAILABLE };

    const tempItems = buildOrderItems(validItems);
    const subtotal  = calcSubtotal(tempItems);
    return { success: true, totals: calcOrderTotals(subtotal, 0) };
  } catch (error) {
    console.error('getCartTotalsService error:', error);
    return { success: false, message: MESSAGES.CHECKOUT.PREPARE_FAILED };
  }
};

// ─── Core: deduct stock + build orderItems (shared by COD/Wallet/Razorpay) ───
async function deductStockAndBuildItems(validItems) {
  const orderItems = [];

  for (const { product, variant, category, qty } of validItems) {
    const stockResult = await Variant.findOneAndUpdate(
      { _id: variant._id, stock: { $gte: qty } },
      { $inc: { stock: -qty } },
      { new: true }
    );

    if (!stockResult) {
      // Rollback all items already deducted in this loop
      for (const deducted of orderItems) {
        await Variant.findByIdAndUpdate(deducted.variant, { $inc: { stock: deducted.quantity } });
      }
      return { success: false, outOfStock: true, message: `"${product.name}" went out of stock. Please update your cart.` };
    }

    const offerResult = calculateOfferPrice(variant, category, product);
    orderItems.push({
      product:      product._id,
      variant:      variant._id,
      productName:  product.name,
      variantColor: variant.color,
      imageUrl:     variant.images?.[0]?.url || product.images?.[0]?.url || '',
      basePrice:    offerResult.finalPrice,
      regularPrice: variant.regularPrice ?? variant.basePrice,
      quantity:     qty,
      itemTotal:    offerResult.finalPrice * qty,
    });
  }

  return { success: true, orderItems };
}

// ─── COD / Wallet: create order + deduct stock + clear cart ──────────────────
export const processCheckoutService = async ({
  userId,
  addressId,
  paymentMethod,
  items,
  isBuyNow  = false,
  couponCode = null,
}) => {
  try {
    const address = await Address.findOne({ _id: addressId, userId });
    if (!address) return { success: false, message: MESSAGES.CHECKOUT.INVALID_ADDRESS };

    let orderItems = [];

    // ── Build order items + deduct stock ─────────────────────────────────────
    if (isBuyNow) {
      if (!items || items.length !== 1)
        return { success: false, message: MESSAGES.CHECKOUT.BUY_NOW_ONE_ITEM };

      const { productId, variantId, quantity } = items[0];
      const product  = await Product.findById(productId).populate('category');
      const variant  = await Variant.findById(variantId);

      if (!product || product.isDeleted || !product.isActive)
        return { success: false, message: MESSAGES.PRODUCT.NOT_AVAILABLE };
      if (!variant || variant.isDeleted || !variant.isActive)
        return { success: false, message: MESSAGES.PRODUCT.VARIANT_UNAVAILABLE };
      if (!product.category?.isListed)
        return { success: false, message: MESSAGES.PRODUCT.CATEGORY_UNAVAILABLE };
      if (variant.stock < quantity)
        return { success: false, message: `Insufficient stock. Available: ${variant.stock}` };

      const stockResult = await Variant.findOneAndUpdate(
        { _id: variantId, stock: { $gte: quantity } },
        { $inc: { stock: -quantity } },
        { new: true }
      );
      if (!stockResult)
        return { success: false, message: 'Failed to reserve stock. Item may be out of stock.' };

      const offerResult = calculateOfferPrice(variant, product.category, product);
      orderItems = [{
        product:      productId,
        variant:      variantId,
        productName:  product.name,
        variantColor: variant.color,
        imageUrl:     variant.images?.[0]?.url || product.images?.[0]?.url || '',
        basePrice:    offerResult.finalPrice,
        regularPrice: variant.regularPrice ?? variant.basePrice,
        quantity,
        itemTotal:    offerResult.finalPrice * quantity,
      }];

    } else {
      const cart = await Cart.findOne({ user: userId })
        .populate({ path: 'items.product', populate: { path: 'category' } })
        .populate('items.variant');

      if (!cart || cart.items.length === 0)
        return { success: false, message: MESSAGES.CART.EMPTY };

      const { validItems, blockedItems } = await validateCartItems(cart.items);

      if (validItems.length === 0)
        return { success: false, message: MESSAGES.CHECKOUT.CART_UNAVAILABLE };
      if (blockedItems.length > 0)
        return { success: false, message: `${MESSAGES.CHECKOUT.ITEMS_UNAVAILABLE}: ${blockedItems.map(b => b.reason).join(', ')}` };

      const stockResult = await deductStockAndBuildItems(validItems);
      if (!stockResult.success) return stockResult;
      orderItems = stockResult.orderItems;

      cart.items = [];
      await cart.save();
    }

    // ── Resolve coupon server-side (NEVER trust client discount amount) ───────
    const subtotal = calcSubtotal(orderItems);
    let discountAmount = 0;
    let resolvedCouponCode = null;

    if (couponCode) {
      try {
        const resolved = await resolveCoupon(couponCode, subtotal);
        discountAmount     = resolved.discountAmount;
        resolvedCouponCode = resolved.couponCode;

        // Increment usedCount only when the order is actually being placed
        if (resolved.couponId) {
          await Coupon.findByIdAndUpdate(resolved.couponId, { $inc: { usedCount: 1 } });
        }
      } catch (couponErr) {
        // Coupon became invalid between apply and order placement — proceed without discount
        console.warn(`Coupon "${couponCode}" rejected at order time:`, couponErr.message);
        discountAmount     = 0;
        resolvedCouponCode = null;
      }
    }

    // ── Single shared calculation ─────────────────────────────────────────────
    const totals = calcOrderTotals(subtotal, discountAmount);

    const order = new Order({
      user:    userId,
      items:   orderItems,
      shippingAddress: {
        fullName:     address.fullName,
        phone:        address.phone,
        addressLine1: address.streetAddress,
        addressLine2: address.streetAddress2 || '',
        city:         address.city,
        state:        address.state,
        pincode:      address.pincode,
      },
      paymentMethod,
      paymentStatus: 'pending',
      subtotal:   totals.subtotal,
      discount:   totals.discount,
      couponCode: resolvedCouponCode || '',
      tax:        totals.tax,
      shipping:   totals.shipping,
      total:      totals.total,
      status:     'pending',
    });

    await order.save();

    // ── Wallet: debit the SAME total we just saved ────────────────────────────
    if (paymentMethod === 'wallet') {
      const debit = await debitWalletService({
        userId,
        amount:      totals.total,
        description: `Payment for order #${order._id.toString().slice(-8).toUpperCase()}`,
        orderId:     order._id,
        category:    'purchase',
      });

      if (!debit.success) {
        // Rollback: delete order + restore stock
        await order.deleteOne();
        for (const oi of orderItems) {
          await Variant.findByIdAndUpdate(oi.variant, { $inc: { stock: oi.quantity } });
        }
        // Also undo usedCount increment if coupon was applied
        if (resolvedCouponCode) {
          await Coupon.findOneAndUpdate(
            { code: resolvedCouponCode },
            { $inc: { usedCount: -1 } }
          );
        }
        return { success: false, message: debit.message };
      }

      order.paymentStatus = 'paid';
      await order.save();
    }

    return {
      success: true,
      message: MESSAGES.ORDER.PLACED_SUCCESS,
      order: {
        _id:           order._id,
        orderNumber:   order._id.toString().slice(-8).toUpperCase(),
        total:         order.total,
        status:        order.status,
        paymentMethod: order.paymentMethod,
        createdAt:     order.createdAt,
      },
    };
  } catch (error) {
    console.error('processCheckoutService error:', error);
    return { success: false, message: error.message || MESSAGES.CHECKOUT.PROCESS_FAILED };
  }
};

// ─── Razorpay: create order AFTER signature verification ─────────────────────
export const processRazorpayOrderService = async ({
  userId,
  addressId,
  razorpayPaymentId,
  razorpayOrderId,
  couponCode = null,
}) => {
  try {
    const address = await Address.findOne({ _id: addressId, userId });
    if (!address) return { success: false, message: MESSAGES.CHECKOUT.INVALID_ADDRESS };

    const cart = await Cart.findOne({ user: userId })
      .populate({ path: 'items.product', populate: { path: 'category' } })
      .populate('items.variant');

    if (!cart || cart.items.length === 0)
      return { success: false, message: MESSAGES.CART.EMPTY };

    const { validItems, blockedItems } = await validateCartItems(cart.items);

    if (validItems.length === 0) {
      const stockIssue = blockedItems.some(b => b.reason.includes('stock'));
      return {
        success:    false,
        outOfStock: stockIssue,
        message:    stockIssue
          ? 'Product went out of stock during payment. Please update your cart.'
          : MESSAGES.CHECKOUT.CART_UNAVAILABLE,
      };
    }

    if (blockedItems.length > 0) {
      const stockIssue = blockedItems.some(b => b.reason.includes('stock'));
      return {
        success:    false,
        outOfStock: stockIssue,
        message:    stockIssue
          ? 'Some items went out of stock during payment. Please update your cart.'
          : `${MESSAGES.CHECKOUT.ITEMS_UNAVAILABLE}: ${blockedItems.map(b => b.reason).join(', ')}`,
      };
    }

    // ── Atomic stock deduction ────────────────────────────────────────────────
    const stockResult = await deductStockAndBuildItems(validItems);
    if (!stockResult.success) return stockResult;
    const orderItems = stockResult.orderItems;

    cart.items = [];
    await cart.save();

    // ── Resolve coupon server-side ────────────────────────────────────────────
    const subtotal = calcSubtotal(orderItems);
    let discountAmount = 0;
    let resolvedCouponCode = null;

    if (couponCode) {
      try {
        const resolved = await resolveCoupon(couponCode, subtotal);
        discountAmount     = resolved.discountAmount;
        resolvedCouponCode = resolved.couponCode;

        if (resolved.couponId) {
          await Coupon.findByIdAndUpdate(resolved.couponId, { $inc: { usedCount: 1 } });
        }
      } catch (couponErr) {
        console.warn(`Coupon "${couponCode}" rejected at Razorpay order time:`, couponErr.message);
        discountAmount     = 0;
        resolvedCouponCode = null;
      }
    }

    // ── Single shared calculation ─────────────────────────────────────────────
    const totals = calcOrderTotals(subtotal, discountAmount);

    const order = new Order({
      user:    userId,
      items:   orderItems,
      shippingAddress: {
        fullName:     address.fullName,
        phone:        address.phone,
        addressLine1: address.streetAddress,
        addressLine2: address.streetAddress2 || '',
        city:         address.city,
        state:        address.state,
        pincode:      address.pincode,
      },
      paymentMethod:     'razorpay',
      paymentStatus:     'paid',
      razorpayOrderId,
      razorpayPaymentId,
      subtotal:   totals.subtotal,
      discount:   totals.discount,
      couponCode: resolvedCouponCode || '',
      tax:        totals.tax,
      shipping:   totals.shipping,
      total:      totals.total,
      status:     'pending',
    });

    await order.save();

    return {
      success: true,
      message: MESSAGES.ORDER.PLACED_SUCCESS,
      order: {
        _id:         order._id,
        orderNumber: order._id.toString().slice(-8).toUpperCase(),
        total:       order.total,
      },
    };
  } catch (error) {
    console.error('processRazorpayOrderService error:', error);
    return { success: false, message: error.message || MESSAGES.CHECKOUT.PROCESS_FAILED };
  }
};
