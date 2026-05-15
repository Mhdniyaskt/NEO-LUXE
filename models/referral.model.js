import mongoose from 'mongoose';

const referralSchema = new mongoose.Schema(
  {
    referrer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    referred: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    referralCode: {
      type: String,
      required: true,
    },
    reward: {
      type: Number,
      default: 200,
    },
    status: {
      type: String,
      enum: ['pending', 'completed', 'cancelled'],
      default: 'completed', // completed immediately on signup
    },
    rewardStatus: {
      type: String,
      enum: ['paid', 'pending'],
      default: 'paid', // paid immediately on signup
    },
  },
  { timestamps: true }
);

export default mongoose.model('Referral', referralSchema);
