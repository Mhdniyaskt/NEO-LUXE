import User              from '../models/user.model.js';
import WalletTransaction from '../models/wallet.model.js';

// ─── Get true balance from latest transaction (ground truth) ─────────────────
async function getTrueBalance(userId) {
  const latest = await WalletTransaction.findOne({ user: userId })
    .sort({ createdAt: -1 })
    .select('balanceAfter')
    .lean();

  if (latest) {
    // Sync User document to match
    await User.findByIdAndUpdate(userId, { walletBalance: latest.balanceAfter });
    return latest.balanceAfter;
  }

  // No transactions yet — read from User document
  const user = await User.findById(userId).select('walletBalance').lean();
  return user?.walletBalance ?? 0;
}

// ─── Credit wallet and record transaction ────────────────────────────────────
export const creditWalletService = async ({ userId, amount, description, orderId = null, category = 'other' }) => {
  try {
    // Get true current balance first
    const currentBalance = await getTrueBalance(userId);
    const newBalance     = currentBalance + amount;

    // Update User document with the correct new balance
    const user = await User.findByIdAndUpdate(
      userId,
      { walletBalance: newBalance },
      { new: true, select: 'walletBalance' }
    );
    if (!user) return { success: false, message: 'User not found' };

    await WalletTransaction.create({
      user:         userId,
      type:         'credit',
      amount,
      balanceAfter: newBalance,
      description,
      orderId,
      category,
    });

    return { success: true, balance: newBalance };
  } catch (error) {
    console.error('creditWalletService error:', error);
    return { success: false, message: 'Failed to credit wallet' };
  }
};

// ─── Debit wallet and record transaction ─────────────────────────────────────
export const debitWalletService = async ({ userId, amount, description, orderId = null, category = 'purchase' }) => {
  try {
    // Always derive balance from transaction history — never trust User.walletBalance alone
    const currentBalance = await getTrueBalance(userId);

    if (currentBalance < amount) {
      return { success: false, message: `Insufficient wallet balance. Available: ₹${currentBalance.toLocaleString('en-IN')}` };
    }

    const newBalance = currentBalance - amount;

    // Update User document
    const user = await User.findByIdAndUpdate(
      userId,
      { walletBalance: newBalance },
      { new: true, select: 'walletBalance' }
    );
    if (!user) return { success: false, message: 'User not found' };

    await WalletTransaction.create({
      user:         userId,
      type:         'debit',
      amount,
      balanceAfter: newBalance,
      description,
      orderId,
      category,
    });

    return { success: true, balance: newBalance };
  } catch (error) {
    console.error('debitWalletService error:', error);
    return { success: false, message: 'Failed to debit wallet' };
  }
};

// ─── Get wallet balance + paginated transactions ──────────────────────────────
export const getWalletService = async (userId, page = 1, limit = 10) => {
  try {
    const skip  = (page - 1) * limit;
    const total = await WalletTransaction.countDocuments({ user: userId });

    const transactions = await WalletTransaction.find({ user: userId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    // Always derive balance from transaction history
    const balance = await getTrueBalance(userId);

    return {
      success:      true,
      balance,
      transactions,
      pagination: {
        currentPage: page,
        totalPages:  Math.ceil(total / limit),
        total,
      },
    };
  } catch (error) {
    console.error('getWalletService error:', error);
    return { success: false, message: 'Failed to fetch wallet' };
  }
};
