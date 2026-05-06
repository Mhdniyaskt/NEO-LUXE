// controllers/user/cart.controller.js
import asyncHandler from '../../utils/asyncHandler.util.js';
import {
  getCartService,
  addToCartService,
  removeFromCartService,
  updateCartQuantityService,
  clearCartService
} from '../../services/cart.service.js';

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

// ─── DELETE /cart/remove/:productId/:variantId ──────────────────────────────
export const removeFromCart = asyncHandler(async (req, res) => {
  const userId = req.session.user.id;
  const { productId, variantId } = req.params;

  const result = await removeFromCartService(userId, productId, variantId);
  
  if (result.success) {
    // Get updated cart summary
    const cartResult = await getCartService(userId);
    return res.json({
      ...result,
      summary: cartResult.success ? cartResult.cart.summary : null
    });
  }
  
  return res.json(result);
});

// ─── PATCH /cart/update-qty ──────────────────────────────────────────────────
export const updateQty = asyncHandler(async (req, res) => {
  const userId = req.session.user.id;
  const { productId, variantId, quantity } = req.body;

  const result = await updateCartQuantityService(userId, productId, variantId, quantity);
  
  if (result.success) {
    // Get updated cart data
    const cartResult = await getCartService(userId);
    if (cartResult.success) {
      const item = cartResult.cart.items.find(item => 
        item.product._id.toString() === productId && 
        item.variant._id.toString() === variantId
      );
      
      return res.json({
        ...result,
        quantity: item ? item.quantity : quantity,
        itemSubtotal: item ? item.variant.basePrice * item.quantity : 0,
        basePrice: item ? item.variant.basePrice : 0,
        finalPrice: item ? item.variant.basePrice : 0,
        ...cartResult.cart.summary
      });
    }
  }
  
  return res.json(result);
});

// ─── DELETE /cart/clear ──────────────────────────────────────────────────────
export const clearCart = asyncHandler(async (req, res) => {
  const userId = req.session.user.id;
  
  const result = await clearCartService(userId);
  return res.json(result);
});