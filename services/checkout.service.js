import mongoose from 'mongoose';
import Cart from '../models/cart.model.js';
import Variant from '../models/variant.model.js';
import Product from '../models/product.model.js';
import Category from '../models/category.model.js';
import Address from '../models/address.model.js';
import Order from '../models/order.model.js';

const MAX_QTY = 10;

// ─── Validate cart items against live stock/availability ─────────────────────
async function validateCartItems(cartItems) {
  const validItems = [];
  const blockedItems = [];
  const stockErrors = [];

  for (const item of cartItems) {
    const product = await Product.findById(item.product).populate('category').lean();
    const variant = await Variant.findById(item.variant).lean();
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
        name: product.name,
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
  const tax = Math.round(subtotal * 0.18);
  const total = subtotal + tax + shipping;
  return { subtotal, shipping, tax, total };
}

// ─── Get checkout data with validated cart ───────────────────────────────────
export const getCheckoutDataService = async (userId) => {
  try {
    // Get user's cart
    const cart = await Cart.findOne({ user: userId })
      .populate({ path: 'items.product', populate: { path: 'category' } })
      .populate('items.variant');

    if (!cart || cart.items.length === 0) {
      return { success: false, message: 'Cart is empty' };
    }

    // Validate cart items
    const { validItems, blockedItems, stockErrors } = await validateCartItems(cart.items);

    if (validItems.length === 0) {
      return { 
        success: false, 
        message: 'No valid items in cart',
        blockedItems,
        stockErrors
      };
    }

    // Calculate totals
    const totals = calcTotals(validItems);

    // Get user addresses
    const addresses = await Address.find({ userId })
      .sort({ isDefault: -1, createdAt: -1 })
      .lean();

    // Prepare checkout items
    const checkoutItems = validItems.map(({ item, product, variant, qty }) => ({
      product: {
        _id: product._id,
        name: product.name,
        brand: product.brand,
        images: product.images
      },
      variant: {
        _id: variant._id,
        color: variant.color,
        basePrice: variant.basePrice,
        finalPrice: variant.finalPrice,
        images: variant.images
      },
      quantity: qty,
      price: variant.basePrice,
      subtotal: variant.basePrice * qty
    }));

    return {
      success: true,
      checkout: {
        items: checkoutItems,
        totals,
        addresses,
        issues: {
          blockedItems,
          stockErrors
        }
      }
    };
  } catch (error) {
    console.error('Get checkout data service error:', error);
    return { success: false, message: 'Failed to prepare checkout data' };
  }
};

// ─── Validate single product for buy now ─────────────────────────────────────
export const validateBuyNowService = async (productId, variantId, quantity = 1) => {
  try {
    quantity = Math.max(1, Math.min(MAX_QTY, parseInt(quantity) || 1));

    const product = await Product.findById(productId).populate('category');
    if (!product || product.isDeleted || !product.isActive) {
      return { success: false, message: 'Product is not available' };
    }

    const variant = await Variant.findById(variantId);
    if (!variant || variant.isDeleted || !variant.isActive) {
      return { success: false, message: 'Selected variant is not available' };
    }

    if (!product.category || !product.category.isListed) {
      return { success: false, message: 'Product category is not available' };
    }

    if (variant.stock === 0) {
      return { success: false, message: 'Product is out of stock' };
    }

    if (quantity > variant.stock) {
      return { success: false, message: `Only ${variant.stock} items available` };
    }

    // Calculate totals for single item
    const subtotal = variant.basePrice * quantity;
    const shipping = subtotal >= 5000 ? 0 : 50;
    const tax = Math.round(subtotal * 0.18);
    const total = subtotal + tax + shipping;

    const buyNowItem = {
      product: {
        _id: product._id,
        name: product.name,
        brand: product.brand,
        images: product.images
      },
      variant: {
        _id: variant._id,
        color: variant.color,
        basePrice: variant.basePrice,
        finalPrice: variant.finalPrice,
        images: variant.images
      },
      quantity,
      price: variant.basePrice,
      subtotal
    };

    return {
      success: true,
      buyNow: {
        item: buyNowItem,
        totals: { subtotal, shipping, tax, total }
      }
    };
  } catch (error) {
    console.error('Validate buy now service error:', error);
    return { success: false, message: 'Failed to validate product for purchase' };
  }
};

// ─── Process checkout and create order ────────────────────────────────────────
export const processCheckoutService = async (checkoutData) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      userId,
      addressId,
      paymentMethod,
      items, // For buy now, this will be a single item array
      isBuyNow = false
    } = checkoutData;

    // Validate address
    const address = await Address.findOne({ _id: addressId, userId });
    if (!address) {
      throw new Error('Invalid shipping address');
    }

    let orderItems = [];

    if (isBuyNow) {
      // Buy now - validate single item
      if (!items || items.length !== 1) {
        throw new Error('Buy now requires exactly one item');
      }

      const item = items[0];
      const product = await Product.findById(item.productId).populate('category');
      const variant = await Variant.findById(item.variantId);

      // Validate availability
      if (!product || product.isDeleted || !product.isActive) {
        throw new Error('Product is not available');
      }
      if (!variant || variant.isDeleted || !variant.isActive) {
        throw new Error('Variant is not available');
      }
      if (!product.category || !product.category.isListed) {
        throw new Error('Product category is not available');
      }
      if (variant.stock < item.quantity) {
        throw new Error(`Insufficient stock. Available: ${variant.stock}`);
      }

      orderItems = [{
        product: item.productId,
        variant: item.variantId,
        quantity: item.quantity,
        price: variant.basePrice
      }];

      // Deduct stock
      const stockResult = await Variant.findOneAndUpdate(
        { _id: item.variantId, stock: { $gte: item.quantity } },
        { $inc: { stock: -item.quantity } },
        { session, new: true }
      );

      if (!stockResult) {
        throw new Error('Failed to reserve stock. Item may be out of stock.');
      }
    } else {
      // Regular checkout - validate cart
      const cart = await Cart.findOne({ user: userId })
        .populate({ path: 'items.product', populate: { path: 'category' } })
        .populate('items.variant')
        .session(session);

      if (!cart || cart.items.length === 0) {
        throw new Error('Cart is empty');
      }

      const { validItems, blockedItems } = await validateCartItems(cart.items);

      if (validItems.length === 0) {
        throw new Error('No valid items in cart');
      }

      if (blockedItems.length > 0) {
        throw new Error(`Some items are no longer available: ${blockedItems.map(b => b.reason).join(', ')}`);
      }

      // Prepare order items and deduct stock
      for (const { item, variant, qty } of validItems) {
        orderItems.push({
          product: item.product._id,
          variant: item.variant._id,
          quantity: qty,
          price: variant.basePrice
        });

        // Atomic stock deduction
        const stockResult = await Variant.findOneAndUpdate(
          { _id: item.variant._id, stock: { $gte: qty } },
          { $inc: { stock: -qty } },
          { session, new: true }
        );

        if (!stockResult) {
          throw new Error(`Failed to reserve stock for ${item.product.name}`);
        }
      }

      // Clear cart
      cart.items = [];
      await cart.save({ session });
    }

    // Calculate order totals
    const subtotal = orderItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const shipping = subtotal >= 5000 ? 0 : 50;
    const tax = Math.round(subtotal * 0.18);
    const total = subtotal + tax + shipping;

    // Create order
    const order = new Order({
      user: userId,
      items: orderItems,
      shippingAddress: {
        fullName: address.fullName,
        phone: address.phone,
        streetAddress: address.streetAddress,
        city: address.city,
        state: address.state,
        pincode: address.pincode,
        addressType: address.addressType
      },
      paymentMethod,
      paymentStatus: paymentMethod === 'cod' ? 'pending' : 'paid',
      subtotal,
      tax,
      shipping,
      total,
      status: 'pending'
    });

    await order.save({ session });

    await session.commitTransaction();

    return {
      success: true,
      message: 'Order placed successfully',
      order: {
        _id: order._id,
        orderNumber: order._id.toString().slice(-8).toUpperCase(),
        total: order.total,
        status: order.status,
        paymentMethod: order.paymentMethod,
        createdAt: order.createdAt
      }
    };
  } catch (error) {
    await session.abortTransaction();
    console.error('Process checkout service error:', error);
    return { success: false, message: error.message || 'Failed to process checkout' };
  } finally {
    session.endSession();
  }
};

// ─── Validate checkout before processing ─────────────────────────────────────
export const validateCheckoutService = async (userId, addressId, items = null) => {
  try {
    // Validate address
    const address = await Address.findOne({ _id: addressId, userId });
    if (!address) {
      return { success: false, message: 'Invalid shipping address' };
    }

    if (items) {
      // Buy now validation
      if (items.length !== 1) {
        return { success: false, message: 'Buy now requires exactly one item' };
      }

      const item = items[0];
      const product = await Product.findById(item.productId).populate('category');
      const variant = await Variant.findById(item.variantId);

      if (!product || product.isDeleted || !product.isActive) {
        return { success: false, message: 'Product is not available' };
      }
      if (!variant || variant.isDeleted || !variant.isActive) {
        return { success: false, message: 'Variant is not available' };
      }
      if (variant.stock < item.quantity) {
        return { success: false, message: `Insufficient stock. Available: ${variant.stock}` };
      }
    } else {
      // Cart validation
      const cart = await Cart.findOne({ user: userId })
        .populate({ path: 'items.product', populate: { path: 'category' } })
        .populate('items.variant');

      if (!cart || cart.items.length === 0) {
        return { success: false, message: 'Cart is empty' };
      }

      const { validItems, blockedItems } = await validateCartItems(cart.items);

      if (validItems.length === 0) {
        return { 
          success: false, 
          message: 'No valid items in cart',
          blockedItems: blockedItems.map(b => b.reason)
        };
      }

      if (blockedItems.length > 0) {
        return {
          success: false,
          message: 'Some items in your cart are no longer available',
          blockedItems: blockedItems.map(b => b.reason)
        };
      }
    }

    return { success: true, message: 'Checkout validation passed' };
  } catch (error) {
    console.error('Validate checkout service error:', error);
    return { success: false, message: 'Checkout validation failed' };
  }
};