import asyncHandler from '../../utils/asyncHandler.util.js';
import Wishlist from '../../models/wishlist.model.js';
import Product from '../../models/product.model.js';
import Variant from '../../models/variant.model.js';
import Cart from '../../models/cart.model.js';

const MAX_CART_ITEMS = 5;
const MAX_QTY = 10;

// ─── GET /user/wishlist ───────────────────────────────────────────────────────
export const getWishlist = asyncHandler(async (req, res) => {
  const userId = req.session.user.id;

  const wishlist = await Wishlist.findOne({ user: userId })
    .populate({ path: 'items.product', populate: { path: 'category', select: 'name isListed' } })
    .populate('items.variant')
    .lean();

  // Filter out hard-deleted products/variants; keep unavailable ones visible
  const items = (wishlist?.items || []).filter(
    item => item.product && !item.product.isDeleted && item.variant && !item.variant.isDeleted
  );

  res.render('user/wishlist', {
    layout: 'layouts/user',
    items,
    path: '/user/wishlist',
  });
});

// ─── POST /user/wishlist/toggle ───────────────────────────────────────────────
// Adds if not present, removes if already in wishlist
export const toggleWishlist = asyncHandler(async (req, res) => {
  const userId = req.session?.user?.id;
  if (!userId) {
    return res.status(401).json({ success: false, message: 'Please login first' });
  }

  const { productId, variantId } = req.body;
  if (!productId || !variantId) {
    return res.status(400).json({ success: false, message: 'Product and variant are required' });
  }

  let wishlist = await Wishlist.findOne({ user: userId });

  if (!wishlist) {
    wishlist = new Wishlist({ user: userId, items: [] });
  }

  const existingIdx = wishlist.items.findIndex(
    i => i.variant.toString() === variantId
  );

  if (existingIdx > -1) {
    // Already in wishlist — remove it
    wishlist.items.splice(existingIdx, 1);
    await wishlist.save();
    return res.json({ success: true, wishlisted: false, message: 'Removed from wishlist' });
  } else {
    // Add to wishlist
    wishlist.items.push({ product: productId, variant: variantId });
    await wishlist.save();
    return res.json({ success: true, wishlisted: true, message: 'Added to wishlist' });
  }
});

// ─── DELETE /user/wishlist/:variantId ─────────────────────────────────────────
export const removeFromWishlist = asyncHandler(async (req, res) => {
  const userId = req.session.user.id;
  const { variantId } = req.params;

  await Wishlist.findOneAndUpdate(
    { user: userId },
    { $pull: { items: { variant: variantId } } }
  );

  return res.json({ success: true, message: 'Removed from wishlist' });
});

// ─── POST /user/wishlist/move-to-cart ─────────────────────────────────────────
// Moves a wishlist item to cart then removes it from wishlist
export const moveToCart = asyncHandler(async (req, res) => {
  const userId = req.session?.user?.id;
  if (!userId) {
    return res.status(401).json({ success: false, message: 'Please login first' });
  }

  const { productId, variantId } = req.body;

  // Validate product & variant availability
  const product = await Product.findById(productId).populate('category').lean();
  const variant  = await Variant.findById(variantId).lean();

  if (!product || product.isDeleted || !product.isActive) {
    return res.status(400).json({ success: false, message: 'Product is unavailable' });
  }
  if (!product.category || !product.category.isListed) {
    return res.status(400).json({ success: false, message: 'Product category is unlisted' });
  }
  if (!variant || variant.isDeleted || !variant.isActive) {
    return res.status(400).json({ success: false, message: 'Variant is unavailable' });
  }
  if (variant.stock === 0) {
    return res.status(400).json({ success: false, message: 'This item is out of stock' });
  }

  // Add to cart
  let cart = await Cart.findOne({ user: userId });

  if (!cart) {
    cart = new Cart({ user: userId, items: [{ product: productId, variant: variantId, quantity: 1 }] });
  } else {
    const idx = cart.items.findIndex(i => i.variant.toString() === variantId);
    if (idx > -1) {
      // Already in cart — just bump quantity if possible
      const newQty = cart.items[idx].quantity + 1;
      if (newQty > MAX_QTY) {
        return res.json({ success: false, message: `Maximum ${MAX_QTY} units already in cart` });
      }
      if (newQty > variant.stock) {
        return res.json({ success: false, message: 'Exceeds available stock' });
      }
      cart.items[idx].quantity = newQty;
    } else {
      if (cart.items.length >= MAX_CART_ITEMS) {
        return res.json({ success: false, message: `Cart is full (max ${MAX_CART_ITEMS} products)` });
      }
      cart.items.push({ product: productId, variant: variantId, quantity: 1 });
    }
  }

  await cart.save();

  // Remove from wishlist
  await Wishlist.findOneAndUpdate(
    { user: userId },
    { $pull: { items: { variant: variantId } } }
  );

  const cartCount = cart.items.length;
  return res.json({ success: true, message: 'Moved to cart', cartCount });
});

// ─── GET /user/wishlist/ids ───────────────────────────────────────────────────
// Returns the set of wishlisted variantIds for the current user (used to seed UI state)
export const getWishlistIds = asyncHandler(async (req, res) => {
  const userId = req.session?.user?.id;
  if (!userId) return res.json({ ids: [] });

  const wishlist = await Wishlist.findOne({ user: userId }).select('items.variant').lean();
  const ids = (wishlist?.items || []).map(i => i.variant.toString());
  return res.json({ ids });
});
