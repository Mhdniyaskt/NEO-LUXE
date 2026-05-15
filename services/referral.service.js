import User from '../models/user.model.js';
import Referral from '../models/referral.model.js';
import { creditWalletService } from './wallet.service.js';
import crypto from 'crypto';

const REFERRAL_REWARD = 200; // ₹200 for both referrer and referred

// ─── Generate unique referral code for a user ────────────────────────────────
export const generateReferralCode = async (userId) => {
  const user = await User.findById(userId);
  if (!user) return null;

  if (user.referralCode) return user.referralCode;

  // Generate a unique 8-char code
  let code;
  let exists = true;
  while (exists) {
    code = crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 8);
    exists = await User.findOne({ referralCode: code });
  }

  user.referralCode = code;
  await user.save();
  return code;
};

// ─── Process referral on signup (called after OTP verification) ───────────────
export const processReferral = async (newUserId, referralCode) => {
  if (!referralCode || !referralCode.trim()) return { success: false };

  const code = referralCode.trim().toUpperCase();

  // Find the referrer by their referral code
  const referrer = await User.findOne({ referralCode: code });
  if (!referrer) return { success: false, message: 'Invalid referral code' };

  // Can't refer yourself
  if (referrer._id.toString() === newUserId.toString()) {
    return { success: false, message: 'Cannot use your own referral code' };
  }

  // Check if this user was already referred
  const existingReferral = await Referral.findOne({ referred: newUserId });
  if (existingReferral) return { success: false, message: 'Already referred' };

  // Create referral record
  await Referral.create({
    referrer:     referrer._id,
    referred:     newUserId,
    referralCode: code,
    reward:       REFERRAL_REWARD,
    status:       'completed',
    rewardStatus: 'paid',
  });

  // Mark the new user as referred
  await User.findByIdAndUpdate(newUserId, { referredBy: code });

  // Credit ₹200 to referrer's wallet
  await creditWalletService({
    userId:      referrer._id,
    amount:      REFERRAL_REWARD,
    description: `Referral reward — new user signed up with your code`,
    category:    'admin_credit',
  });

  // Credit ₹200 to new user's wallet
  await creditWalletService({
    userId:      newUserId,
    amount:      REFERRAL_REWARD,
    description: `Welcome bonus — signed up with referral code ${code}`,
    category:    'admin_credit',
  });

  // Generate referral code for the new user too
  await generateReferralCode(newUserId);

  return { success: true };
};

// ─── Get referral stats for a user ───────────────────────────────────────────
export const getUserReferralData = async (userId) => {
  // Ensure user has a referral code
  await generateReferralCode(userId);
  const user = await User.findById(userId).select('referralCode name').lean();

  const referrals = await Referral.find({ referrer: userId })
    .populate('referred', 'name email createdAt')
    .sort({ createdAt: -1 })
    .lean();

  const totalReferrals   = referrals.length;
  const successfulCount  = referrals.filter(r => r.status === 'completed').length;
  const totalRewards     = referrals.reduce((sum, r) => sum + (r.rewardStatus === 'paid' ? r.reward : 0), 0);

  return {
    referralCode:    user.referralCode,
    totalReferrals,
    successfulCount,
    totalRewards,
    referrals,
  };
};

// ─── Admin: get all referrals with pagination ────────────────────────────────
export const getAllReferralsAdmin = async (page = 1, limit = 15, search = '') => {
  const skip   = (page - 1) * limit;
  const filter = {};

  if (search) {
    const users = await User.find({
      $or: [
        { name:  { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ],
    }).select('_id').lean();
    const userIds = users.map(u => u._id);
    filter.$or = [
      { referrer: { $in: userIds } },
      { referred: { $in: userIds } },
    ];
  }

  const [referrals, total] = await Promise.all([
    Referral.find(filter)
      .populate('referrer', 'name email')
      .populate('referred', 'name email createdAt')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Referral.countDocuments(filter),
  ]);

  // Stats
  const totalGenerated   = await User.countDocuments({ referralCode: { $exists: true, $ne: null } });
  const successfulTotal  = await Referral.countDocuments({ status: 'completed' });
  const [rewardStats]    = await Referral.aggregate([
    { $match: { rewardStatus: 'paid' } },
    { $group: { _id: null, total: { $sum: '$reward' } } },
  ]);
  const [pendingStats]   = await Referral.aggregate([
    { $match: { rewardStatus: 'pending' } },
    { $group: { _id: null, total: { $sum: '$reward' } } },
  ]);

  return {
    referrals,
    stats: {
      totalGenerated,
      successfulTotal,
      totalRewardsGiven:  (rewardStats?.total || 0) * 2, // both users get reward
      pendingRewards:     (pendingStats?.total || 0) * 2,
    },
    pagination: {
      currentPage: page,
      totalPages:  Math.ceil(total / limit),
      total,
    },
  };
};
