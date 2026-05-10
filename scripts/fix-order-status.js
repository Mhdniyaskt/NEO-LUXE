/**
 * One-time script: fix orders that were incorrectly set to 'returned'
 * when only some items were approved for return.
 *
 * Run: node scripts/fix-order-status.js
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

import Order from '../models/order.model.js';

await mongoose.connect(process.env.MONGO_URI);
console.log('Connected to MongoDB');

const orders = await Order.find({ status: 'returned' });
let fixed = 0;

for (const order of orders) {
  const activeItems = order.items.filter(i => i.status !== 'cancelled');
  const allApproved = activeItems.length > 0 && activeItems.every(i => i.returnStatus === 'approved');

  if (!allApproved) {
    // Some active items are NOT approved — order should be 'delivered'
    console.log(`Fixing order ${order._id.toString().slice(-8).toUpperCase()}: returned → delivered`);
    order.status = 'delivered';
    // Only mark refunded if at least one item was approved
    if (!activeItems.some(i => i.returnStatus === 'approved')) {
      order.paymentStatus = 'paid';
    }
    await order.save();
    fixed++;
  }
}

console.log(`Done. Fixed ${fixed} order(s).`);
await mongoose.disconnect();
