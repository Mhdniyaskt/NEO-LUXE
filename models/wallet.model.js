import mongoose from 'mongoose';

const walletTransactionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ['credit', 'debit'],
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    // Running balance after this transaction
    balanceAfter: {
      type: Number,
      required: true,
    },
    description: {
      type: String,
      required: true,
    },
    // Optional reference to an order
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      default: null,
    },
    // Reason category for display icons
    category: {
      type: String,
      enum: ['refund', 'purchase', 'cancellation', 'admin_credit', 'topup', 'other'],
      default: 'other',
    },
  },
  { timestamps: true }
);

export default mongoose.model('WalletTransaction', walletTransactionSchema);
