import Wishlist from '../models/wishlist.model.js';
import Product from '../models/product.model.js';
import Variant from '../models/variant.model.js';
import Cart from '../models/cart.model.js';
import { MESSAGES } from '../constants/messages.constant.js';
import { calculateOfferPrice } from '../utils/offerPrice.util.js';

// ─── Get user wishlist with product details ──────────────────────────────────
export const getWishlistService = async (userId, page = 1, limit = 12) => {
  try {
    const skip = (page - 1) * limit;

    const wishlist = await Wishlist.findOne({ user: userId })
      .populate({
        path: 'items.product',
        populate: { path: 'category' },
        match: { isDeleted: false } // Only get non-deleted products
      })
      .populate({
        path: 'items.variant',
        match: { isDeleted: false } // Only get non-deleted variants
      })
      .lean();

    if (!wishlist || wishlist.items.length === 0) {
      return {
        success: true,
        wishlist: { items: [] },
        pagination: { currentPage: page, totalPages: 0, total: 0 }
      };
    }

    // Filter out items where product or variant is null (deleted)
    const validItems = wishlist.items.filter(item => 
      item.product && item.variant && 
      item.product.category && item.product.category.isListed
    );

    // Add availability and pricing info
    const enrichedItems = await Promise.all(validItems.map(async (item) => {
      const { product, variant } = item;
      
      // Check availability
      const isAvailable = product.isActive && variant.isActive && variant.stock > 0;
      
      // Get all variants for this product to show options
      const allVariants = await Variant.find({
        product: product._id,
        isDeleted: false,
        isActive: true
      }).select('_id color basePrice finalPrice stock').lean();

      return {
        _id: item._id,
        product: {
          _id: product._id,
          name: product.name,
          brand: product.brand,
          images: product.images,
          category: product.category,
          isActive: product.isActive,
        },
        variant: {
          _id: variant._id,
          color: variant.color,
          basePrice: variant.basePrice,
          finalPrice: variant.finalPrice,
          stock: variant.stock,
          images: variant.images,
          isActive: variant.isActive,
          appliedOffer: (() => {
            const offerResult = calculateOfferPrice(variant, product.category, product);
            return offerResult.offerPercentage;
          })(),
        },
        allVariants,
        isAvailable,
        addedAt: item.addedAt
      };
    }));

    // Pagination
    const total = enrichedItems.length;
    const paginatedItems = enrichedItems.slice(skip, skip + limit);
    const totalPages = Math.ceil(total / limit);

    return {
      success: true,
      wishlist: { items: paginatedItems },
      pagination: {
        currentPage: page,
        totalPages,
        total,
        hasNext: page < totalPages,
        hasPrev: page > 1
      }
    };
  } catch (error) {
    console.error('Get wishlist service error:', error);
    return { success: false, message: MESSAGES.WISHLIST.FETCH_FAILED };
  }
};

// ─── Add item to wishlist ─────────────────────────────────────────────────────
export const addToWishlistService = async (userId, productId, variantId) => {
  try {
    // Validate product and variant
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

    // Get or create wishlist
    let wishlist = await Wishlist.findOne({ user: userId });
    if (!wishlist) {
      wishlist = new Wishlist({ user: userId, items: [] });
    }

    // Check if item already exists
    const existingItem = wishlist.items.find(item => 
      item.product.toString() === productId && item.variant.toString() === variantId
    );

    if (existingItem) {
      return { success: false, message: MESSAGES.WISHLIST.ALREADY_EXISTS };
    }

    // Add item to wishlist
    wishlist.items.push({
      product: productId,
      variant: variantId,
      addedAt: new Date()
    });

    await wishlist.save();

    return { success: true, message: MESSAGES.WISHLIST.ITEM_ADDED };
  } catch (error) {
    console.error('Add to wishlist service error:', error);
    return { success: false, message: MESSAGES.WISHLIST.ITEM_ADD_FAILED };
  }
};

// ─── Remove item from wishlist ────────────────────────────────────────────────
export const removeFromWishlistService = async (userId, productId, variantId) => {
  try {
    const wishlist = await Wishlist.findOne({ user: userId });
    if (!wishlist) {
      return { success: false, message: MESSAGES.WISHLIST.NOT_FOUND };
    }

    const itemIndex = wishlist.items.findIndex(item => 
      item.product.toString() === productId && item.variant.toString() === variantId
    );

    if (itemIndex === -1) {
      return { success: false, message: MESSAGES.WISHLIST.ITEM_NOT_FOUND };
    }

    wishlist.items.splice(itemIndex, 1);
    await wishlist.save();

    return { success: true, message: MESSAGES.WISHLIST.ITEM_REMOVED };
  } catch (error) {
    console.error('Remove from wishlist service error:', error);
    return { success: false, message: MESSAGES.WISHLIST.ITEM_REMOVE_FAILED };
  }
};

// ─── Toggle item in wishlist ──────────────────────────────────────────────────
export const toggleWishlistService = async (userId, productId, variantId) => {
  try {
    // Get or create wishlist
    let wishlist = await Wishlist.findOne({ user: userId });
    if (!wishlist) {
      wishlist = new Wishlist({ user: userId, items: [] });
    }

    // Check if item exists
    const itemIndex = wishlist.items.findIndex(item => 
      item.product.toString() === productId && item.variant.toString() === variantId
    );

    if (itemIndex >= 0) {
      // Remove from wishlist
      wishlist.items.splice(itemIndex, 1);
      await wishlist.save();
      return { success: true, message: MESSAGES.WISHLIST.ITEM_REMOVED, action: 'removed' };
    } else {
      // Add to wishlist
      const result = await addToWishlistService(userId, productId, variantId);
      if (result.success) {
        return { success: true, message: MESSAGES.WISHLIST.ITEM_ADDED, action: 'added' };
      }
      return result;
    }
  } catch (error) {
    console.error('Toggle wishlist service error:', error);
    return { success: false, message: MESSAGES.WISHLIST.UPDATE_FAILED };
  }
};

// ─── Move item from wishlist to cart ──────────────────────────────────────────
export const moveToCartService = async (userId, productId, variantId, quantity = 1) => {
  try {
    // Validate product and variant availability
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

    // Add to cart
    let cart = await Cart.findOne({ user: userId });
    if (!cart) {
      cart = new Cart({ user: userId, items: [] });
    }

    // Check if item already exists in cart
    const existingCartItem = cart.items.find(item => 
      item.product.toString() === productId && item.variant.toString() === variantId
    );

    if (existingCartItem) {
      // Update quantity
      const newQty = existingCartItem.quantity + quantity;
      if (newQty > variant.stock) {
        return { success: false, message: `Cannot add more. Only ${variant.stock} items available` };
      }
      existingCartItem.quantity = newQty;
    } else {
      // Add new item
      cart.items.push({
        product: productId,
        variant: variantId,
        quantity
      });
    }

    await cart.save();

    // Remove from wishlist
    const wishlist = await Wishlist.findOne({ user: userId });
    if (wishlist) {
      const itemIndex = wishlist.items.findIndex(item => 
        item.product.toString() === productId && item.variant.toString() === variantId
      );
      
      if (itemIndex >= 0) {
        wishlist.items.splice(itemIndex, 1);
        await wishlist.save();
      }
    }

    return { success: true, message: MESSAGES.WISHLIST.MOVED_TO_CART };
  } catch (error) {
    console.error('Move to cart service error:', error);
    return { success: false, message: MESSAGES.WISHLIST.MOVE_FAILED };
  }
};

// ─── Check if item is in wishlist ─────────────────────────────────────────────
export const checkWishlistService = async (userId, productId, variantId) => {
  try {
    const wishlist = await Wishlist.findOne({ user: userId });
    if (!wishlist) {
      return { success: true, inWishlist: false };
    }

    const isInWishlist = wishlist.items.some(item => 
      item.product.toString() === productId && item.variant.toString() === variantId
    );

    return { success: true, inWishlist: isInWishlist };
  } catch (error) {
    console.error('Check wishlist service error:', error);
    return { success: false, message: MESSAGES.WISHLIST.CHECK_FAILED };
  }
};

// ─── Clear entire wishlist ────────────────────────────────────────────────────
export const clearWishlistService = async (userId) => {
  try {
    await Wishlist.findOneAndUpdate(
      { user: userId },
      { $set: { items: [] } },
      { upsert: true }
    );

    return { success: true, message: MESSAGES.WISHLIST.CLEARED };
  } catch (error) {
    console.error('Clear wishlist service error:', error);
    return { success: false, message: MESSAGES.WISHLIST.CLEAR_FAILED };
  }
};

// ─── Get wishlist count ───────────────────────────────────────────────────────
export const getWishlistCountService = async (userId) => {
  try {
    const wishlist = await Wishlist.findOne({ user: userId });
    const count = wishlist ? wishlist.items.length : 0;
    
    return { success: true, count };
  } catch (error) {
    console.error('Get wishlist count service error:', error);
    return { success: false, message: MESSAGES.WISHLIST.COUNT_FAILED };
  }
};