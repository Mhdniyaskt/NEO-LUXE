/**
 * fix.calculations.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Utility to fix calculation discrepancies in existing orders.
 * Run this once to correct all historical data.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import mongoose from 'mongoose';
import Order from '../models/order.model.js';
import { validateOrderCalculation, debugOrderCalculation } from './calculation.validator.js';
import { calcOrderTotals, calcSubtotal } from './orderCalc.util.js';

/**
 * Fix calculations for a single order
 * @param {Object} order - Order document
 * @returns {Promise<{fixed: boolean, changes: Object}>}
 */
async function fixOrderCalculation(order) {
  const validation = validateOrderCalculation(order);
  
  if (validation.isValid) {
    return { fixed: false, changes: {} };
  }
  
  console.log(`🔧 Fixing order ${order._id}:`);
  validation.discrepancies.forEach(disc => console.log(`  - ${disc}`));
  
  const changes = {};
  const corrected = validation.corrected;
  
  // Update fields that are incorrect
  if (Math.abs(order.subtotal - corrected.subtotal) > 0.01) {
    changes.subtotal = corrected.subtotal;
    order.subtotal = corrected.subtotal;
  }
  
  if (Math.abs(order.shipping - corrected.shipping) > 0.01) {
    changes.shipping = corrected.shipping;
    order.shipping = corrected.shipping;
  }
  
  if (Math.abs(order.tax - corrected.tax) > 0.01) {
    changes.tax = corrected.tax;
    order.tax = corrected.tax;
  }
  
  if (Math.abs((order.discount || 0) - corrected.discount) > 0.01) {
    changes.discount = corrected.discount;
    order.discount = corrected.discount;
  }
  
  if (Math.abs(order.total - corrected.total) > 0.01) {
    changes.total = corrected.total;
    order.total = corrected.total;
  }
  
  // Save the corrected order
  await order.save();
  
  console.log(`✅ Fixed order ${order._id}`);
  
  return { fixed: true, changes };
}

/**
 * Fix all orders with calculation discrepancies
 * @param {boolean} dryRun - If true, only identify issues without fixing
 * @returns {Promise<{fixed: number, total: number, errors: Array}>}
 */
export async function fixAllOrderCalculations(dryRun = false) {
  console.log(`🔍 ${dryRun ? 'Analyzing' : 'Fixing'} order calculations...`);
  
  const orders = await Order.find({})
    .populate('items.product')
    .populate('items.variant')
    .lean(false); // Keep as mongoose docs for saving
  
  let fixedCount = 0;
  const errors = [];
  
  for (const order of orders) {
    try {
      const validation = validateOrderCalculation(order);
      
      if (!validation.isValid) {
        console.log(`\n📋 Order ${order._id} (${order.status}):`);
        validation.discrepancies.forEach(disc => console.log(`  ❌ ${disc}`));
        
        if (!dryRun) {
          const result = await fixOrderCalculation(order);
          if (result.fixed) {
            fixedCount++;
            console.log(`  🔧 Changes:`, result.changes);
          }
        }
      }
    } catch (error) {
      console.error(`❌ Error processing order ${order._id}:`, error.message);
      errors.push({ orderId: order._id, error: error.message });
    }
  }
  
  console.log(`\n📊 Summary:`);
  console.log(`  Total orders processed: ${orders.length}`);
  console.log(`  Orders ${dryRun ? 'with issues' : 'fixed'}: ${fixedCount}`);
  console.log(`  Errors: ${errors.length}`);
  
  return {
    fixed: fixedCount,
    total: orders.length,
    errors
  };
}

/**
 * Test calculation fix on a specific order
 * @param {string} orderId - Order ID to test
 */
export async function testOrderCalculationFix(orderId) {
  console.log(`🧪 Testing calculation fix for order: ${orderId}`);
  
  const order = await Order.findById(orderId);
  if (!order) {
    console.log('❌ Order not found');
    return;
  }
  
  console.log('\n--- BEFORE FIX ---');
  debugOrderCalculation(order);
  
  const validation = validateOrderCalculation(order);
  if (!validation.isValid) {
    console.log('\n--- APPLYING FIX ---');
    const result = await fixOrderCalculation(order);
    console.log('Changes made:', result.changes);
    
    console.log('\n--- AFTER FIX ---');
    const fixedOrder = await Order.findById(orderId);
    debugOrderCalculation(fixedOrder);
  } else {
    console.log('✅ Order calculation is already correct!');
  }
}

/**
 * CLI interface for running the fix
 */
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const command = process.argv[2];
  const arg = process.argv[3];
  
  // Connect to database
  await mongoose.connect(process.env.DATABASE_URL);
  console.log('📡 Connected to database');
  
  try {
    switch (command) {
      case 'analyze':
        await fixAllOrderCalculations(true);
        break;
      case 'fix':
        await fixAllOrderCalculations(false);
        break;
      case 'test':
        if (!arg) {
          console.log('Usage: node fix.calculations.js test <orderId>');
          process.exit(1);
        }
        await testOrderCalculationFix(arg);
        break;
      default:
        console.log('Usage:');
        console.log('  node fix.calculations.js analyze   - Find calculation issues');
        console.log('  node fix.calculations.js fix       - Fix all calculation issues');
        console.log('  node fix.calculations.js test <id> - Test fix on specific order');
    }
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}