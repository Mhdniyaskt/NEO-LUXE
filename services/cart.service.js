import Cart from '../models/cart.model.js';
import Variant from '../models/variant.model.js';
import Product from '../models/product.model.js';
import { MESSAGES } from '../constants/messages.constant.js';

const MAX_QTY = 10;   // max quantity per variant line
const MAX_ITEMS = 5;  // max distinct products in cart

// ─── Helper: recalculate cart totals from a populated cart ───────────────────
function calcSummary(items) {
  let subtotal = 0;
  for (const item of items) {
    subtotal += item.variant.basePrice * item.quantity;
  }
  const shipping = subtotal >= 5000 ? 0 : 50;
  const tax = Math.round(subtotal * 0.18);
  const total = subtotal + tax + shipping;
  return { subtotal, tax, shipping, discount: 0, total };
}

// ─── Validate cart items against live stock/availability ─────────────────────
async function validateCartItems(cartItems) {
  const validItems = [];
  const cartIssues = [];

  for (const item of cartItems) {
    const { product, variant } = item;
    const category = product?.category;

    if (!product || product.isDeleted || !product.isActive) {
      cartIssues.push({ productId: item.product._id, variantId: item.variant._id, issue: MESSAGES.PRODUCT.NOT_AVAILABLE });
      continue;
    }
    if (!variant || variant.isDeleted || !variant.isActive) {
      cartIssues.push({ productId: item.product._id, variantId: item.variant._id, issue: MESSAGES.PRODUCT.VARIANT_UNAVAILABLE });
      continue;
    }
    if (!category || !category.isListed) {
      cartIssues.push({ productId: item.product._id, variantId: item.variant._id, issue: MESSAGES.PRODUCT.CATEGORY_UNAVAILABLE });
      continue;
    }
    if (variant.stock === 0) {
      cartIssues.push({ productId: item.product._id, variantId: item.variant._id, issue: MESSAGES.PRODUCT.OUT_OF_STOCK });
      continue;
    }

    let adjustedQty = item.quantity;
    if (item.quantity > variant.stock) {
      adjustedQty = variant.stock;
      cartIssues.push({ productId: item.product._id, variantId: item.variant._id, issue: `Quantity reduced to ${variant.stock} (available stock)` });
    }

    validItems.push({ ...item.toObject(), quantity: adjustedQty });
  }

  return { validItems, cartIssues };
}

// ─── Get user cart with validation ───────────────────────────────────────────
export const getCartService = async (userId) => {
  try {
    const cart = await Cart.findOne({ user: userId })
      .populate({ path: 'items.product', populate: { path: 'category' } })
      .populate('items.variant');

    if (!cart || cart.items.length === 0) {
      return {
        success: true,
        cart: { items: [], summary: { subtotal: 0, tax: 0, shipping: 0, discount: 0, total: 0 } },
        cartIssues: []
      };
    }

    const { validItems, cartIssues } = await validateCartItems(cart.items);

    if (cartIssues.length > 0) {
      cart.items = validItems;
      await cart.save();
    }

    const summary = calcSummary(validItems);
    return { success: true, cart: { items: validItems, summary }, cartIssues };
  } catch (error) {
    console.error('Cart service error:', error);
    return { success: false, message: MESSAGES.CART.FETCH_FAILED };
  }
};

// ─── Add item to cart ─────────────────────────────────────────────────────────
export const addToCartService = async (userId, productId, variantId, quantity = 1) => {
  try {
    if (!productId || !variantId) {
      return { success: false, message: MESSAGES.CART.PRODUCT_VARIANT_REQUIRED };
    }

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

    let cart = await Cart.findOne({ user: userId });
    if (!cart) {
      cart = new Cart({ user: userId, items: [] });
    }

    const existingItemIndex = cart.items.findIndex(
      item => item.product.toString() === productId && item.variant.toString() === variantId
    );

    if (existingItemIndex >= 0) {
      const newQty = cart.items[existingItemIndex].quantity + quantity;
      if (newQty > variant.stock) {
        return { success: false, message: `Cannot add more. Only ${variant.stock} items available` };
      }
      if (newQty > MAX_QTY) {
        return { success: false, message: `Maximum ${MAX_QTY} items allowed per product` };
      }
      cart.items[existingItemIndex].quantity = newQty;
    } else {
      if (cart.items.length >= MAX_ITEMS) {
        return { success: false, message: `Maximum ${MAX_ITEMS} different products allowed in cart` };
      }
      cart.items.push({ product: productId, variant: variantId, quantity });
    }

    await cart.save();
    return { success: true, message: MESSAGES.CART.ITEM_ADDED };
  } catch (error) {
    console.error('Add to cart service error:', error);
    return { success: false, message: MESSAGES.CART.ITEM_ADD_FAILED };
  }
};

// ─── Remove item from cart ────────────────────────────────────────────────────
export const removeFromCartService = async (userId, productId, variantId) => {
  try {
    const cart = await Cart.findOne({ user: userId });
    if (!cart) {
      return { success: false, message: MESSAGES.CART.NOT_FOUND };
    }

    const itemIndex = cart.items.findIndex(
      item => item.product.toString() === productId && item.variant.toString() === variantId
    );

    if (itemIndex === -1) {
      return { success: false, message: MESSAGES.CART.ITEM_NOT_FOUND };
    }

    cart.items.splice(itemIndex, 1);
    await cart.save();
    return { success: true, message: MESSAGES.CART.ITEM_REMOVED };
  } catch (error) {
    console.error('Remove from cart service error:', error);
    return { success: false, message: MESSAGES.CART.ITEM_REMOVE_FAILED };
  }
};

// ─── Update item quantity in cart ─────────────────────────────────────────────
export const updateCartQuantityService = async (userId, productId, variantId, quantity) => {
  try {
    quantity = Math.max(1, Math.min(MAX_QTY, parseInt(quantity) || 1));

    const cart = await Cart.findOne({ user: userId });
    if (!cart) {
      return { success: false, message: MESSAGES.CART.NOT_FOUND };
    }

    const itemIndex = cart.items.findIndex(
      item => item.product.toString() === productId && item.variant.toString() === variantId
    );

    if (itemIndex === -1) {
      return { success: false, message: MESSAGES.CART.ITEM_NOT_FOUND };
    }

    const variant = await Variant.findById(variantId);
    if (!variant || variant.stock < quantity) {
      return { success: false, message: `Only ${variant?.stock || 0} items available` };
    }

    cart.items[itemIndex].quantity = quantity;
    await cart.save();
    return { success: true, message: MESSAGES.CART.UPDATED };
  } catch (error) {
    console.error('Update cart quantity service error:', error);
    return { success: false, message: MESSAGES.CART.UPDATE_FAILED };
  }
};

// ─── Clear entire cart ────────────────────────────────────────────────────────
export const clearCartService = async (userId) => {
  try {
    await Cart.findOneAndUpdate(
      { user: userId },
      { $set: { items: [] } },
      { upsert: true }
    );
    return { success: true, message: MESSAGES.CART.CLEARED };
  } catch (error) {
    console.error('Clear cart service error:', error);
    return { success: false, message: MESSAGES.CART.CLEAR_FAILED };
  }
};
