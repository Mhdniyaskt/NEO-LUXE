// controllers/user/cart.controller.js
import asyncHandler from '../../utils/asyncHandler.util.js';
import Cart from '../../models/cart.model.js';
import Variant from '../../models/variant.model.js';
import Product from '../../models/product.model.js';
import {
  getCartService,
  addToCartService,
  clearCartService
} from '../../services/cart.service.js';
import { calculateOfferPrice } from '../../utils/offerPrice.util.js';

// ─── GET /cart ───────────────────────────────────────────────────────────────
export const getCart = asyncHandler(async (req, res) => {
  if (!req.session?.user?.id) {
    return res.redirect('/login');
  }

  const result = await getCartService(req.session.user.id);
  
  if (!result.success) {
    return res.status(500).render('error', { 
      message: result.message,
      layout: 'layouts/user' 
    });
  }

  res.render('user/cart', {
    layout: 'layouts/user',
    path: 'cart',
    cart: result.cart,
    cartIssues: result.cartIssues || [],
    summary: result.cart.summary
  });
});

// ─── POST /cart/add ──────────────────────────────────────────────────────────
export const addToCart = asyncHandler(async (req, res) => {
  const userId = req.session?.user?.id;
  if (!userId) {
    return res.status(401).json({ success: false, message: 'Please login first' });
  }

  const { productId, variantId, quantity = 1 } = req.body;
  
  const result = await addToCartService(userId, productId, variantId, quantity);
  
  if (result.success) {
    // Get updated cart count
    const cartResult = await getCartService(userId);
    const cartCount = cartResult.success ? cartResult.cart.items.length : 0;
    
    return res.json({
      ...result,
      cartCount
    });
  }
  
  return res.json(result);
});

// ─── DELETE /cart/remove/:variantId ──────────────────────────────────────────
export const removeFromCart = asyncHandler(async (req, res) => {
  const userId = req.session.user.id;
  const { variantId } = req.params;

  const cart = await Cart.findOne({ user: userId });
  if (!cart) {
    return res.json({ success: false, message: 'Cart not found' });
  }

  const itemIndex = cart.items.findIndex(
    item => item.variant.toString() === variantId
  );

  if (itemIndex === -1) {
    return res.json({ success: false, message: 'Item not found in cart' });
  }

  cart.items.splice(itemIndex, 1);
  await cart.save();

  const cartResult = await getCartService(userId);
  return res.json({
    success: true,
    message: 'Item removed from cart',
    summary: cartResult.success ? cartResult.cart.summary : null
  });
});

// ─── PATCH /cart/update-qty ──────────────────────────────────────────────────
export const updateQty = asyncHandler(async (req, res) => {
  const userId = req.session.user.id;
  const { variantId, change } = req.body;

  const cart = await Cart.findOne({ user: userId });
  if (!cart) return res.json({ success: false, message: 'Cart not found' });

  const item = cart.items.find(i => i.variant.toString() === variantId);
  if (!item) return res.json({ success: false, message: 'Item not found in cart' });

  const variant = await Variant.findById(variantId);
  if (!variant) return res.json({ success: false, message: 'Variant not found' });

  const newQty = item.quantity + Number(change);

  if (newQty < 1)             return res.json({ success: false, message: 'Minimum quantity is 1' });
  if (newQty > 10)            return res.json({ success: false, message: 'Maximum 10 units allowed' });
  if (newQty > variant.stock) return res.json({ success: false, message: 'Stock limit reached' });

  item.quantity = newQty;
  await cart.save();

  const cartResult = await getCartService(userId);

  // Calculate offer price for this item
  const product = await Product.findById(item.product).populate('category').lean();
  const offerResult = calculateOfferPrice(variant, product?.category, product);

  return res.json({
    success:      true,
    quantity:     newQty,
    stock:        variant.stock,
    itemSubtotal: offerResult.finalPrice * newQty,
    basePrice:    variant.basePrice,
    finalPrice:   offerResult.finalPrice,
    regularPrice: variant.regularPrice,
    offerPercentage: offerResult.offerPercentage,
    ...(cartResult.success ? cartResult.cart.summary : {})
  });
});

// ─── DELETE /cart/clear ──────────────────────────────────────────────────────
export const clearCart = asyncHandler(async (req, res) => {
  const userId = req.session.user.id;
  
  const result = await clearCartService(userId);
  return res.json(result);
});