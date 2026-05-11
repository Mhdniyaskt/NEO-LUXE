import mongoose from 'mongoose';

const orderItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },
    variant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Variant',
      required: true,
    },
    // Snapshot of product/variant data at time of order
    productName:   { type: String, required: true },
    variantColor:  { type: String, required: true },
    imageUrl:      { type: String, default: '' },
    basePrice:     { type: Number, required: true },
    regularPrice:  { type: Number, required: true },
    quantity:      { type: Number, required: true, min: 1 },
    itemTotal:     { type: Number, required: true },
    // Per-item status — set when item is individually cancelled
    status: {
      type: String,
      enum: ['active', 'cancelled'],
      default: 'active',
    },
    // Per-item return tracking
    returnStatus: {
      type: String,
      enum: ['none', 'requested', 'approved', 'rejected'],
      default: 'none',
    },
    returnReason:   { type: String, default: '' },
    stockRestored:  { type: Boolean, default: false }, // true once returned stock is added back
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    items: [orderItemSchema],

    // Pricing snapshot
    subtotal:  { type: Number, required: true },
    tax:       { type: Number, required: true },
    shipping:  { type: Number, required: true },
    total:     { type: Number, required: true },

    // Shipping address snapshot
    shippingAddress: {
      fullName:   { type: String, required: true },
      phone:      { type: String, required: true },
      addressLine1: { type: String, required: true },
      addressLine2: { type: String, default: '' },
      city:       { type: String, required: true },
      state:      { type: String, required: true },
      pincode:    { type: String, required: true },
    },

    paymentMethod: {
      type: String,
      enum: ['cod', 'razorpay', 'wallet'],
      default: 'cod',
    },
    paymentStatus: {
      type: String,
      enum: ['pending', 'paid', 'failed', 'refunded', 'cancelled'],
      default: 'pending',
    },

    // Razorpay payment tracking
    razorpayOrderId:   { type: String, default: '' },
    razorpayPaymentId: { type: String, default: '' },

    status: {
      type: String,
      enum: ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'returned'],
      default: 'pending',
    },

    // Populated when order is cancelled/returned
    cancelReason: { type: String, default: '' },
  },
  { timestamps: true }
);

export default mongoose.model('Order', orderSchema);
