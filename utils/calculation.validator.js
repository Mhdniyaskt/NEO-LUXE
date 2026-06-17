/**
 * calculation.validator.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Validation utility to ensure all order calculations are consistent across 
 * checkout, order creation, invoices, and order confirmation pages.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { calcOrderTotals, calcSubtotal, GST_RATE, FREE_SHIPPING_THRESHOLD, SHIPPING_CHARGE } from './orderCalc.util.js';

/**
 * Validate calculation consistency between two calculation results
 * @param {Object} calc1 - First calculation result
 * @param {Object} calc2 - Second calculation result  
 * @param {string} context - Context description for debugging
 * @returns {Object} { isValid: boolean, discrepancies: string[] }
 */
export function validateCalculationConsistency(calc1, calc2, context = 'Unknown') {
  const discrepancies = [];
  
  // Check each component
  if (Math.abs(calc1.subtotal - calc2.subtotal) > 0.01) {
    discrepancies.push(`Subtotal mismatch: ${calc1.subtotal} vs ${calc2.subtotal}`);
  }
  
  if (Math.abs(calc1.shipping - calc2.shipping) > 0.01) {
    discrepancies.push(`Shipping mismatch: ${calc1.shipping} vs ${calc2.shipping}`);
  }
  
  if (Math.abs(calc1.tax - calc2.tax) > 0.01) {
    discrepancies.push(`Tax mismatch: ${calc1.tax} vs ${calc2.tax}`);
  }
  
  if (Math.abs(calc1.discount - calc2.discount) > 0.01) {
    discrepancies.push(`Discount mismatch: ${calc1.discount} vs ${calc2.discount}`);
  }
  
  if (Math.abs(calc1.total - calc2.total) > 0.01) {
    discrepancies.push(`Total mismatch: ${calc1.total} vs ${calc2.total}`);
  }
  
  return {
    isValid: discrepancies.length === 0,
    discrepancies,
    context
  };
}

/**
 * Validate an order against the standardized calculation
 * @param {Object} order - Order object with items array and discount
 * @returns {Object} { isValid: boolean, discrepancies: string[], corrected: Object }
 */
export function validateOrderCalculation(order) {
  // Calculate subtotal from items
  const calculatedSubtotal = order.items.reduce((sum, item) => {
    return sum + ((item.itemTotal || (item.basePrice * item.quantity)) || 0);
  }, 0);
  
  // Get standardized calculation
  const standardCalc = calcOrderTotals(calculatedSubtotal, order.discount || 0);
  
  // Compare with order's stored values
  const orderCalc = {
    subtotal: order.subtotal || 0,
    shipping: order.shipping || 0,
    tax: order.tax || 0,
    discount: order.discount || 0,
    total: order.total || 0
  };
  
  const validation = validateCalculationConsistency(orderCalc, standardCalc, `Order ${order._id}`);
  
  return {
    ...validation,
    corrected: standardCalc,
    original: orderCalc
  };
}

/**
 * Log calculation details for debugging
 * @param {Object} calculation - Calculation object
 * @param {string} source - Source description
 */
export function logCalculationDetails(calculation, source) {
  console.log(`\n=== CALCULATION DETAILS: ${source} ===`);
  console.log(`Subtotal: ₹${calculation.subtotal}`);
  console.log(`Shipping: ₹${calculation.shipping} ${calculation.shipping === 0 ? '(FREE)' : ''}`);
  console.log(`Tax (GST ${GST_RATE * 100}%): ₹${calculation.tax}`);
  console.log(`Discount: ₹${calculation.discount}`);
  console.log(`Total: ₹${calculation.total}`);
  console.log(`Formula: ${calculation.subtotal} + ${calculation.tax} + ${calculation.shipping} - ${calculation.discount} = ${calculation.total}`);
  console.log('================================================\n');
}

/**
 * Comprehensive order validation for debugging
 * @param {Object} order - Full order object
 */
export function debugOrderCalculation(order) {
  console.log(`\n🔍 DEBUGGING ORDER CALCULATION: ${order._id}`);
  console.log('─'.repeat(50));
  
  // Item-by-item breakdown
  console.log('ITEMS:');
  order.items.forEach((item, idx) => {
    const itemTotal = item.itemTotal || (item.basePrice * item.quantity) || 0;
    console.log(`  ${idx + 1}. ${item.productName || 'Product'} x${item.quantity} = ₹${itemTotal}`);
  });
  
  // Current order values
  logCalculationDetails({
    subtotal: order.subtotal || 0,
    shipping: order.shipping || 0,
    tax: order.tax || 0,
    discount: order.discount || 0,
    total: order.total || 0
  }, 'STORED IN ORDER');
  
  // Recalculated values
  const validation = validateOrderCalculation(order);
  logCalculationDetails(validation.corrected, 'RECALCULATED');
  
  // Show discrepancies
  if (!validation.isValid) {
    console.log('❌ DISCREPANCIES FOUND:');
    validation.discrepancies.forEach(disc => console.log(`  - ${disc}`));
  } else {
    console.log('✅ CALCULATION IS CORRECT');
  }
  
  console.log('─'.repeat(50));
}

/**
 * Test calculation with sample data
 */
export function testCalculation() {
  console.log('🧪 TESTING CALCULATION LOGIC');
  
  // Test case 1: Normal order
  const test1 = calcOrderTotals(2598, 650);
  console.log('\nTest 1 - Subtotal: ₹2598, Discount: ₹650');
  logCalculationDetails(test1, 'TEST RESULT');
  
  // Test case 2: Free shipping threshold
  const test2 = calcOrderTotals(5500, 100);
  console.log('\nTest 2 - Subtotal: ₹5500, Discount: ₹100 (Free shipping)');
  logCalculationDetails(test2, 'TEST RESULT');
  
  // Test case 3: No discount
  const test3 = calcOrderTotals(1500, 0);
  console.log('\nTest 3 - Subtotal: ₹1500, No discount');
  logCalculationDetails(test3, 'TEST RESULT');
}