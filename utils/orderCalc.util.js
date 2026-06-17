/**
 * orderCalc.util.js
 * ─────────────────────────────────────────────────────────────────────────────
 * SINGLE SOURCE OF TRUTH for all order amount calculations.
 *
 * Rule:
 *   subtotal  = sum of (finalPrice × qty) for each item
 *   shipping  = ₹50, free when subtotal ≥ ₹5,000
 *   tax       = Math.round(subtotal × 0.18)   ← GST on full product value ONLY
 *   discount  = coupon saving (applied AFTER tax, not on the tax base)
 *   total     = subtotal + tax + shipping − discount  (min ₹0)
 *
 * Every place that needs order totals — checkout page, order service,
 * Razorpay flow, wallet flow, invoice PDF — must import from this file.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const GST_RATE      = 0.18;   // 18 %
export const FREE_SHIPPING_THRESHOLD = 5000;
export const SHIPPING_CHARGE        = 50;

/**
 * Calculate the complete breakdown for an order.
 *
 * @param {number} subtotal        - Sum of item totals (offer price × qty)
 * @param {number} [discountAmount=0] - Verified coupon discount in ₹
 * @returns {{ subtotal, shipping, tax, discount, total }}
 */
export function calcOrderTotals(subtotal, discountAmount = 0) {
  // Ensure inputs are valid numbers
  subtotal = Number(subtotal) || 0;
  discountAmount = Number(discountAmount) || 0;
  
  const shipping = subtotal >= FREE_SHIPPING_THRESHOLD ? 0 : SHIPPING_CHARGE;
  const tax      = Math.round(subtotal * GST_RATE);          // always on full subtotal
  const discount = Math.round(discountAmount);               // ensure integer
  const total    = Math.max(0, subtotal + tax + shipping - discount);

  // Log for debugging if there's an environment flag
  if (process.env.DEBUG_CALCULATIONS === 'true') {
    console.log(`[calcOrderTotals] Subtotal: ₹${subtotal}, Discount: ₹${discount}`);
    console.log(`[calcOrderTotals] Shipping: ₹${shipping}, Tax: ₹${tax}, Total: ₹${total}`);
  }

  return { subtotal, shipping, tax, discount, total };
}

/**
 * Build the subtotal from an array of order-item objects.
 * Each item must have { itemTotal: number }.
 *
 * @param {Array<{itemTotal: number}>} items
 * @returns {number}
 */
export function calcSubtotal(items) {
  if (!Array.isArray(items)) return 0;
  
  const subtotal = items.reduce((sum, i) => {
    const itemTotal = Number(i.itemTotal) || 0;
    return sum + itemTotal;
  }, 0);
  
  if (process.env.DEBUG_CALCULATIONS === 'true') {
    console.log(`[calcSubtotal] ${items.length} items, subtotal: ₹${subtotal}`);
  }
  
  return subtotal;
}

/**
 * Validate calculation inputs to prevent errors
 * 
 * @param {number} subtotal 
 * @param {number} discountAmount 
 * @returns {{ isValid: boolean, error?: string }}
 */
export function validateCalculationInputs(subtotal, discountAmount = 0) {
  if (typeof subtotal !== 'number' || isNaN(subtotal) || subtotal < 0) {
    return { isValid: false, error: 'Invalid subtotal amount' };
  }
  
  if (typeof discountAmount !== 'number' || isNaN(discountAmount) || discountAmount < 0) {
    return { isValid: false, error: 'Invalid discount amount' };
  }
  
  if (discountAmount > subtotal + SHIPPING_CHARGE) {
    return { isValid: false, error: 'Discount cannot exceed subtotal + shipping' };
  }
  
  return { isValid: true };
}
