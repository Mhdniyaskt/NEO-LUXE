import Cart from '../models/cart.model.js';
import Variant from '../models/variant.model.js';
import Product from '../models/product.model.js';
import Category from '../models/category.model.js';
import Address from '../models/address.model.js';
import Order from '../models/order.model.js';
import { MESSAGES } from '../constants/messages.constant.js';

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
      return { success: false, message: MESSAGES.CART.EMPTY };
    }

    // Validate cart items
    const { validItems, blockedItems, stockErrors } = await validateCartItems(cart.items);

    if (validItems.length === 0) {
      return {
        success: false,
        message: MESSAGES.CHECKOUT.CART_UNAVAILABLE,
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

    // Prepare checkout items — shape matches what checkout.ejs expects
    const checkoutItems = validItems.map(({ item, product, variant, qty }) => ({
      productId:    product._id,
      variantId:    variant._id,
      productName:  product.name,
      brand:        product.brand,
      color:        variant.color,
      imageUrl:     (variant.images?.[0]?.url) || (product.images?.[0]?.url) || null,
      quantity:     qty,
      basePrice:    variant.basePrice,
      regularPrice: variant.regularPrice ?? variant.basePrice,
      finalPrice:   variant.finalPrice   ?? variant.basePrice,
      itemTotal:    variant.basePrice * qty
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
    return { success: false, message: MESSAGES.CHECKOUT.PREPARE_FAILED };
  }
};

// ─── Validate single product for buy now ─────────────────────────────────────
export const validateBuyNowService = async (productId, variantId, quantity = 1) => {
  try {
    quantity = Math.max(1, Math.min(MAX_QTY, parseInt(quantity) || 1));

    const product = await Product.findById(productId).populate('category');
    if (!product || product.isDeleted || !product.isActive) {
      return { success: false, message: MESSAGES.PRODUCT.NOT_AVAILABLE };
    }

    const variant = await Variant.findById(variantId);
    if (!variant || variant.isDeleted || !variant.isActive) {
      return { success: false, message: MESSAGES.PRODUCT.VARIANT_UNAVAILABLE };
    }

    if (!product.category || !product.category.isListed) {
      return { success: false, message: MESSAGES.PRODUCT.CATEGORY_UNAVAILABLE };
    }

    if (variant.stock === 0) {
      return { success: false, message: MESSAGES.PRODUCT.OUT_OF_STOCK };
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
    return { success: false, message: MESSAGES.CHECKOUT.VALIDATE_FAILED };
  }
};

// ─── Process checkout and create order ────────────────────────────────────────
export const processCheckoutService = async (checkoutData) => {
  try {
    const {
      userId,
      addressId,
      paymentMethod,
      items,
      isBuyNow = false
    } = checkoutData;

    // Validate address
    const address = await Address.findOne({ _id: addressId, userId });
    if (!address) {
      return { success: false, message: MESSAGES.CHECKOUT.INVALID_ADDRESS };
    }

    let orderItems = [];

    if (isBuyNow) {
      if (!items || items.length !== 1) {
        return { success: false, message: MESSAGES.CHECKOUT.BUY_NOW_ONE_ITEM };
      }

      const item = items[0];
      const product = await Product.findById(item.productId).populate('category');
      const variant = await Variant.findById(item.variantId);

      if (!product || product.isDeleted || !product.isActive) {
        return { success: false, message: MESSAGES.PRODUCT.NOT_AVAILABLE };
      }
      if (!variant || variant.isDeleted || !variant.isActive) {
        return { success: false, message: MESSAGES.PRODUCT.VARIANT_UNAVAILABLE };
      }
      if (!product.category || !product.category.isListed) {
        return { success: false, message: MESSAGES.PRODUCT.CATEGORY_UNAVAILABLE };
      }
      if (variant.stock < item.quantity) {
        return { success: false, message: `Insufficient stock. Available: ${variant.stock}` };
      }

      // Deduct stock atomically using findOneAndUpdate
      const stockResult = await Variant.findOneAndUpdate(
        { _id: item.variantId, stock: { $gte: item.quantity } },
        { $inc: { stock: -item.quantity } },
        { new: true }
      );

      if (!stockResult) {
        return { success: false, message: 'Failed to reserve stock. Item may be out of stock.' };
      }

      orderItems = [{
        product:      item.productId,
        variant:      item.variantId,
        productName:  product.name,
        variantColor: variant.color,
        imageUrl:     variant.images?.[0]?.url || product.images?.[0]?.url || '',
        basePrice:    variant.basePrice,
        regularPrice: variant.regularPrice ?? variant.basePrice,
        quantity:     item.quantity,
        itemTotal:    variant.basePrice * item.quantity,
      }];

    } else {
      // Regular checkout — validate cart
      const cart = await Cart.findOne({ user: userId })
        .populate({ path: 'items.product', populate: { path: 'category' } })
        .populate('items.variant');

      if (!cart || cart.items.length === 0) {
        return { success: false, message: MESSAGES.CART.EMPTY };
      }

      const { validItems, blockedItems } = await validateCartItems(cart.items);

      if (validItems.length === 0) {
        return { success: false, message: MESSAGES.CHECKOUT.CART_UNAVAILABLE };
      }

      if (blockedItems.length > 0) {
        return {
          success: false,
          message: `${MESSAGES.CHECKOUT.ITEMS_UNAVAILABLE}: ${blockedItems.map(b => b.reason).join(', ')}`
        };
      }

      // Deduct stock for each item atomically
      for (const { item, variant, qty } of validItems) {
        const stockResult = await Variant.findOneAndUpdate(
          { _id: item.variant._id, stock: { $gte: qty } },
          { $inc: { stock: -qty } },
          { new: true }
        );

        if (!stockResult) {
          return { success: false, message: `Failed to reserve stock for ${item.product.name}. Please try again.` };
        }

        orderItems.push({
          product:      item.product._id,
          variant:      item.variant._id,
          productName:  item.product.name,
          variantColor: variant.color,
          imageUrl:     variant.images?.[0]?.url || item.product.images?.[0]?.url || '',
          basePrice:    variant.basePrice,
          regularPrice: variant.regularPrice ?? variant.basePrice,
          quantity:     qty,
          itemTotal:    variant.basePrice * qty,
        });
      }

      // Clear cart
      cart.items = [];
      await cart.save();
    }

    // Calculate order totals
    const subtotal = orderItems.reduce((sum, item) => sum + item.itemTotal, 0);
    const shipping = subtotal >= 5000 ? 0 : 50;
    const tax      = Math.round(subtotal * 0.18);
    const total    = subtotal + tax + shipping;

    // Create order
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
      paymentStatus: paymentMethod === 'cod' ? 'pending' : 'paid',
      subtotal,
      tax,
      shipping,
      total,
      status: 'pending'
    });

    await order.save();

    return {
      success: true,
      message: MESSAGES.ORDER.PLACED_SUCCESS,
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
    console.error('Process checkout service error:', error);
    return { success: false, message: error.message || MESSAGES.CHECKOUT.PROCESS_FAILED };
  }
};

// ─── Validate checkout before processing ─────────────────────────────────────
export const validateCheckoutService = async (userId, addressId, items = null) => {
  try {
    // Validate address
    const address = await Address.findOne({ _id: addressId, userId });
    if (!address) {
      return { success: false, message: MESSAGES.CHECKOUT.INVALID_ADDRESS };
    }

    if (items) {
      if (items.length !== 1) {
        return { success: false, message: MESSAGES.CHECKOUT.BUY_NOW_ONE_ITEM };
      }

      const item = items[0];
      const product = await Product.findById(item.productId).populate('category');
      const variant = await Variant.findById(item.variantId);

      if (!product || product.isDeleted || !product.isActive) {
        return { success: false, message: MESSAGES.PRODUCT.NOT_AVAILABLE };
      }
      if (!variant || variant.isDeleted || !variant.isActive) {
        return { success: false, message: MESSAGES.PRODUCT.VARIANT_UNAVAILABLE };
      }
      if (variant.stock < item.quantity) {
        return { success: false, message: `Insufficient stock. Available: ${variant.stock}` };
      }
    } else {
      const cart = await Cart.findOne({ user: userId })
        .populate({ path: 'items.product', populate: { path: 'category' } })
        .populate('items.variant');

      if (!cart || cart.items.length === 0) {
        return { success: false, message: MESSAGES.CART.EMPTY };
      }

      const { validItems, blockedItems } = await validateCartItems(cart.items);

      if (validItems.length === 0) {
        return {
          success: false,
          message: MESSAGES.CHECKOUT.CART_UNAVAILABLE,
          blockedItems: blockedItems.map(b => b.reason)
        };
      }

      if (blockedItems.length > 0) {
        return {
          success: false,
          message: MESSAGES.CHECKOUT.ITEMS_UNAVAILABLE,
          blockedItems: blockedItems.map(b => b.reason)
        };
      }
    }

    return { success: true, message: MESSAGES.CHECKOUT.VALIDATION_PASSED };
  } catch (error) {
    console.error('Validate checkout service error:', error);
    return { success: false, message: MESSAGES.CHECKOUT.VALIDATION_FAILED };
  }
};