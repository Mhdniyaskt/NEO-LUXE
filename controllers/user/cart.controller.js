// controllers/user/cartController.js
import asyncHandler from '../../utils/asyncHandler.util.js';
import Variant from '../../models/variant.model.js';
import Cart from '../../models/cart.model.js';
import Product from '../../models/product.model.js';

const MAX_QTY   = 10;   // max quantity per variant line
const MAX_ITEMS = 5;    // max distinct products in cart

// ─── helper: recalculate cart totals from a populated cart ───────────────────
function calcSummary(items) {
  let subtotal = 0;

  for (const item of items) {
    // Using basePrice directly as offers are removed
    const price = item.variant.basePrice;
    subtotal += price * item.quantity;
  }

  const shipping = subtotal >= 5000 ? 0 : 50;
  const tax = Math.round(subtotal * 0.18);
  const total = subtotal + tax + shipping;

  return { 
    subtotal, 
    tax, 
    shipping, 
    discount: 0, // Set to 0 since offers are removed
    total 
  };
}

// ─── GET /cart ───────────────────────────────────────────────────────────────
export const getCart = asyncHandler(async (req, res) => {
  if (!req.session?.user?.id) {
    return res.redirect('/login');
  }

  const cart = await Cart.findOne({ user: req.session.user.id })
    .populate({ path: 'items.product', populate: { path: 'category' } })
    .populate('items.variant');

  const cartIssues = [];

  if (cart && cart.items.length > 0) {
    const validItems = [];

    for (const item of cart.items) {
      const { product, variant } = item;
      const category = product?.category;

      // ── Hard removes (item stripped from cart entirely) ──────────────
      if (!product || !variant || !category) {
        cartIssues.push('Some items are no longer available and were removed.');
        continue;
      }
      if (product.isDeleted) {
        cartIssues.push(`"${product.name}" has been removed from the store.`);
        continue;
      }
      if (variant.isDeleted) {
        cartIssues.push(`A variant of "${product.name}" is no longer available.`);
        continue;
      }

      // ── Soft flags (item kept but marked, blocks checkout) ───────────
      item.blockReason = null;

      if (!product.isActive) {
        item.blockReason = 'Product is currently unlisted';
      } else if (!category.isListed) {
        item.blockReason = `Category "${category.name}" is currently unlisted`;
      } else if (!variant.isActive) {
        item.blockReason = 'This variant is currently unavailable';
      } else if (variant.stock === 0) {
        item.blockReason = 'Out of stock';
      } else if (variant.stock < item.quantity) {
        // Clamp quantity to available stock instead of blocking
        item.quantity = variant.stock;
        cartIssues.push(`Quantity for "${product.name}" adjusted to available stock (${variant.stock}).`);
      }

      if (item.blockReason) {
        cartIssues.push(`"${product.name}": ${item.blockReason}`);
      }

      // Map prices
      item.variant.finalPrice   = variant.basePrice;
      item.variant.regularPrice = variant.regularPrice;
      item.variant.appliedOffer = 0;

      validItems.push(item);
    }

    cart.items = validItems;
    await cart.save();
  }

  const summary = calcSummary(
    (cart?.items ?? []).filter(i => !i.blockReason)
  );

  res.render('user/cart', {
    layout: 'layouts/user',
    cart,
    cartIssues,
    summary,
  });
});

// ─── POST /cart/add ──────────────────────────────────────────────────────────
export const addToCart = asyncHandler(async (req, res) => {
  const userId = req.session?.user?.id;
  if (!userId) {
    return res.status(401).json({ success: false, message: 'Please login first' });
  }

  const { productId, variantId, quantity = 1 } = req.body;
  const qty = Number(quantity);

  const product = await Product.findById(productId).populate('category');
  if (!product || !product.isActive || product.isDeleted) {
    return res.json({ success: false, message: 'Product is unavailable' });
  }
  if (!product.category || !product.category.isListed) {
    return res.json({ success: false, message: 'Product category is unlisted' });
  }

  const variant = await Variant.findById(variantId);
  if (!variant || !variant.isActive || variant.isDeleted) {
    return res.json({ success: false, message: 'Variant not found or unavailable' });
  }
  if (variant.stock === 0) {
    return res.json({ success: false, message: 'This item is out of stock' });
  }

  if (qty < 1) return res.json({ success: false, message: 'Invalid quantity' });
  if (qty > MAX_QTY) return res.json({ success: false, message: `Maximum ${MAX_QTY} units allowed` });
  if (qty > variant.stock) return res.json({ success: false, message: 'Insufficient stock' });

  // Effective ceiling: lower of stock and MAX_QTY
  const maxAllowed = Math.min(variant.stock, MAX_QTY);

  let cart = await Cart.findOne({ user: userId });
  let alreadyInCart = false;
  let newQty = qty;

  if (!cart) {
    // First item — no limit concern
    cart = new Cart({ user: userId, items: [{ product: productId, variant: variantId, quantity: qty }] });
  } else {
    const idx = cart.items.findIndex((i) => i.variant.toString() === variantId);
    if (idx > -1) {
      // Variant already in cart — just update quantity, no new item slot used
      alreadyInCart = true;
      newQty = cart.items[idx].quantity + qty;
      if (newQty > MAX_QTY) {
        return res.json({
          success: false,
          message: `You already have ${cart.items[idx].quantity} in your cart. Maximum ${MAX_QTY} units allowed.`,
          alreadyInCart: true,
          currentQty: cart.items[idx].quantity,
          maxAllowed,
        });
      }
      if (newQty > variant.stock) {
        return res.json({
          success: false,
          message: `Only ${variant.stock} units available. You already have ${cart.items[idx].quantity} in your cart.`,
          alreadyInCart: true,
          currentQty: cart.items[idx].quantity,
          maxAllowed,
        });
      }
      cart.items[idx].quantity = newQty;
    } else {
      // New distinct item — enforce the 5-item limit
      if (cart.items.length >= MAX_ITEMS) {
        return res.json({
          success: false,
          message: `Your cart is full. You can only have ${MAX_ITEMS} different products at a time.`,
          cartFull: true,
        });
      }
      cart.items.push({ product: productId, variant: variantId, quantity: qty });
    }
  }

  await cart.save();

  const cartCount = cart.items.length;
  return res.json({
    success: true,
    message: alreadyInCart ? 'Cart updated' : 'Added to cart',
    alreadyInCart,
    newQty,
    maxAllowed,
    cartCount,
  });
});

// ─── DELETE /cart/remove/:variantId ─────────────────────────────────────────
export const removeFromCart = asyncHandler(async (req, res) => {
  const userId = req.session.user.id;
  const { variantId } = req.params;

  const cart = await Cart.findOne({ user: userId })
    .populate({ path: 'items.product', populate: { path: 'category' } })
    .populate('items.variant');

  if (!cart) return res.json({ success: false, message: 'Cart not found' });

  cart.items = cart.items.filter((i) => i.variant._id.toString() !== variantId);
  await cart.save();

  const summary = calcSummary(cart.items);
  return res.json({ success: true, message: 'Item removed', summary });
});

// ─── PATCH /cart/update-qty ──────────────────────────────────────────────────
export const updateQty = asyncHandler(async (req, res) => {
  const userId = req.session.user.id;
  const { variantId, change } = req.body;

  const cart = await Cart.findOne({ user: userId });
  if (!cart) return res.status(404).json({ success: false, message: 'Cart not found' });

  const item = cart.items.find((i) => i.variant.toString() === variantId);
  if (!item) return res.status(404).json({ success: false, message: 'Item not found in cart' });

  const variant = await Variant.findById(variantId);
  const product = await Product.findById(item.product).populate('category');
  if (!variant || !product) return res.status(400).json({ success: false, message: 'Product unavailable' });

  const newQty = item.quantity + Number(change);

  if (newQty < 1) return res.json({ success: false, message: 'Minimum quantity is 1' });
  if (newQty > MAX_QTY) return res.json({ success: false, message: `Maximum ${MAX_QTY} units allowed` });
  if (newQty > variant.stock) return res.json({ success: false, message: 'Stock limit reached' });

  item.quantity = newQty;
  await cart.save();

  const populated = await Cart.findOne({ user: userId })
    .populate({ path: 'items.product', populate: { path: 'category' } })
    .populate('items.variant');

  const summary = calcSummary(populated.items);

  return res.json({
    success: true,
    quantity: newQty,
    stock: variant.stock,
    itemSubtotal: variant.basePrice * newQty,
    basePrice: variant.basePrice,
    finalPrice: variant.basePrice, // Matching finalPrice to basePrice
    ...summary,
  });
});