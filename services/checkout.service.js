import Cart from '../models/cart.model.js';
import Variant from '../models/variant.model.js';
import Product from '../models/product.model.js';
import Category from '../models/category.model.js';
import Address from '../models/address.model.js';
import Order from '../models/order.model.js';
import User from '../models/user.model.js';
import { MESSAGES } from '../constants/messages.constant.js';
import { debitWalletService } from './wallet.service.js';

const MAX_QTY = 10;

// ─── Validate cart items against live stock/availability ─────────────────────
async function validateCartItems(cartItems) {
  const validItems   = [];
  const blockedItems = [];
  const stockErrors  = [];

  for (const item of cartItems) {
    // item.product and item.variant may be either ObjectIds or populated documents
    const productId = item.product?._id || item.product;
    const variantId = item.variant?._id || item.variant;

    const product  = await Product.findById(productId).populate('category').lean();
    const variant  = await Variant.findById(variantId).lean();
    const category = product?.category;

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

// ─── Helper: compute order totals ────────────────────────────────────────────
function calcTotals(items) {
  const subtotal = items.reduce((sum, { variant, qty }) => sum + variant.basePrice * qty, 0);
  const shipping = subtotal >= 5000 ? 0 : 50;
  const tax      = Math.round(subtotal * 0.18);
  const total    = subtotal + tax + shipping;
  return { subtotal, shipping, tax, total };
}

// ─── Get checkout page data ───────────────────────────────────────────────────
export const getCheckoutDataService = async (userId) => {
  try {
    const cart = await Cart.findOne({ user: userId })
      .populate({ path: 'items.product', populate: { path: 'category' } })
      .populate('items.variant');

    if (!cart || cart.items.length === 0) {
      return { success: false, message: MESSAGES.CART.EMPTY };
    }

    const { validItems, blockedItems, stockErrors } = await validateCartItems(cart.items);

    if (validItems.length === 0) {
      return { success: false, message: MESSAGES.CHECKOUT.CART_UNAVAILABLE, blockedItems, stockErrors };
    }

    const totals    = calcTotals(validItems);
    const addresses = await Address.find({ userId }).sort({ isDefault: -1, createdAt: -1 }).lean();

    const checkoutItems = validItems.map(({ item, product, variant, qty }) => ({
      productId:    product._id,
      variantId:    variant._id,
      productName:  product.name,
      brand:        product.brand,
      color:        variant.color,
      imageUrl:     variant.images?.[0]?.url || product.images?.[0]?.url || null,
      quantity:     qty,
      basePrice:    variant.basePrice,
      regularPrice: variant.regularPrice ?? variant.basePrice,
      finalPrice:   variant.finalPrice   ?? variant.basePrice,
      itemTotal:    variant.basePrice * qty,
    }));

    return {
      success: true,
      checkout: { items: checkoutItems, totals, addresses, issues: { blockedItems, stockErrors } },
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

    const subtotal = variant.basePrice * quantity;
    const shipping = subtotal >= 5000 ? 0 : 50;
    const tax      = Math.round(subtotal * 0.18);
    const total    = subtotal + tax + shipping;

    return {
      success: true,
      buyNow: {
        item: {
          product: { _id: product._id, name: product.name, brand: product.brand, images: product.images },
          variant: { _id: variant._id, color: variant.color, basePrice: variant.basePrice,
                     regularPrice: variant.regularPrice, finalPrice: variant.finalPrice, images: variant.images },
          quantity,
          price: variant.basePrice,
          subtotal,
        },
        totals: { subtotal, shipping, tax, total },
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
      // Buy-now validation
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
      // Cart validation
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

    return { success: true, totals: calcTotals(validItems) };
  } catch (error) {
    console.error('getCartTotalsService error:', error);
    return { success: false, message: MESSAGES.CHECKOUT.PREPARE_FAILED };
  }
};

// ─── COD: create order + deduct stock + clear cart ────────────────────────────
export const processCheckoutService = async ({ userId, addressId, paymentMethod, items, isBuyNow = false }) => {
  try {
    const address = await Address.findOne({ _id: addressId, userId });
    if (!address) return { success: false, message: MESSAGES.CHECKOUT.INVALID_ADDRESS };

    let orderItems = [];

    if (isBuyNow) {
      if (!items || items.length !== 1)
        return { success: false, message: MESSAGES.CHECKOUT.BUY_NOW_ONE_ITEM };

      const { productId, variantId, quantity } = items[0];
      const product = await Product.findById(productId).populate('category');
      const variant = await Variant.findById(variantId);

      if (!product || product.isDeleted || !product.isActive)
        return { success: false, message: MESSAGES.PRODUCT.NOT_AVAILABLE };
      if (!variant || variant.isDeleted || !variant.isActive)
        return { success: false, message: MESSAGES.PRODUCT.VARIANT_UNAVAILABLE };
      if (!product.category || !product.category.isListed)
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

      orderItems = [{
        product:      productId,
        variant:      variantId,
        productName:  product.name,
        variantColor: variant.color,
        imageUrl:     variant.images?.[0]?.url || product.images?.[0]?.url || '',
        basePrice:    variant.basePrice,
        regularPrice: variant.regularPrice ?? variant.basePrice,
        quantity,
        itemTotal:    variant.basePrice * quantity,
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

      for (const { item, product, variant, qty } of validItems) {
        const stockResult = await Variant.findOneAndUpdate(
          { _id: variant._id, stock: { $gte: qty } },
          { $inc: { stock: -qty } },
          { new: true }
        );
        if (!stockResult)
          return { success: false, message: `Failed to reserve stock for ${product.name}. Please try again.` };

        orderItems.push({
          product:      product._id,
          variant:      variant._id,
          productName:  product.name,
          variantColor: variant.color,
          imageUrl:     variant.images?.[0]?.url || product.images?.[0]?.url || '',
          basePrice:    variant.basePrice,
          regularPrice: variant.regularPrice ?? variant.basePrice,
          quantity:     qty,
          itemTotal:    variant.basePrice * qty,
        });
      }

      cart.items = [];
      await cart.save();
    }

    const subtotal = orderItems.reduce((s, i) => s + i.itemTotal, 0);
    const shipping = subtotal >= 5000 ? 0 : 50;
    const tax      = Math.round(subtotal * 0.18);
    const total    = subtotal + tax + shipping;

    const order = new Order({
      user: userId,
      items: orderItems,
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
      paymentStatus: 'pending', // COD = paid on delivery; razorpay = set to 'paid' after verify
      subtotal, tax, shipping, total,
      status: 'pending',
    });

    await order.save();

    // ── Wallet payment: debit balance immediately ─────────────────────
    if (paymentMethod === 'wallet') {
      const debit = await debitWalletService({
        userId,
        amount:      total,
        description: `Payment for order #${order._id.toString().slice(-8).toUpperCase()}`,
        orderId:     order._id,
        category:    'purchase',
      });
      if (!debit.success) {
        // Roll back: delete order and restore stock
        await order.deleteOne();
        for (const oi of orderItems) {
          await Variant.findByIdAndUpdate(oi.variant, { $inc: { stock: oi.quantity } });
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
// Called only when Razorpay payment is confirmed — THEN deduct stock + clear cart
export const processRazorpayOrderService = async ({ userId, addressId, razorpayPaymentId, razorpayOrderId }) => {
  try {
    const address = await Address.findOne({ _id: addressId, userId });
    if (!address) return { success: false, message: MESSAGES.CHECKOUT.INVALID_ADDRESS };

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

    // Deduct stock atomically for each item
    // Uses findOneAndUpdate with stock >= qty condition — if another user
    // bought the last item first, this returns null and we abort with outOfStock
    const orderItems = [];
    for (const { item, product, variant, qty } of validItems) {
      const stockResult = await Variant.findOneAndUpdate(
        { _id: variant._id, stock: { $gte: qty } },
        { $inc: { stock: -qty } },
        { new: true }
      );
      if (!stockResult) {
        // Restore any stock already deducted in this loop before failing
        for (const deducted of orderItems) {
          await Variant.findByIdAndUpdate(deducted.variant, { $inc: { stock: deducted.quantity } });
        }
        return {
          success:    false,
          outOfStock: true,
          message:    `Sorry, "${product.name}" just sold out. Your payment will be refunded automatically within 5–7 business days.`,
        };
      }

      orderItems.push({
        product:      product._id,
        variant:      variant._id,
        productName:  product.name,
        variantColor: variant.color,
        imageUrl:     variant.images?.[0]?.url || product.images?.[0]?.url || '',
        basePrice:    variant.basePrice,
        regularPrice: variant.regularPrice ?? variant.basePrice,
        quantity:     qty,
        itemTotal:    variant.basePrice * qty,
      });
    }

    // Clear cart
    cart.items = [];
    await cart.save();

    const subtotal = orderItems.reduce((s, i) => s + i.itemTotal, 0);
    const shipping = subtotal >= 5000 ? 0 : 50;
    const tax      = Math.round(subtotal * 0.18);
    const total    = subtotal + tax + shipping;

    const order = new Order({
      user: userId,
      items: orderItems,
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
      subtotal, tax, shipping, total,
      status: 'pending',
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
