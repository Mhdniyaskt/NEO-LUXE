import Razorpay from "razorpay";
import crypto from "crypto";
import asyncHandler from "../../utils/asyncHandler.util.js";
import {
  getWalletService,
  creditWalletService,
} from "../../services/wallet.service.js";

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// ─── GET /wallet 
export const getWallet = asyncHandler(async (req, res) => {
  const userId = req.session.user.id;
  const page = Math.max(1, parseInt(req.query.page) || 1);

  const result = await getWalletService(userId, page, 10);
  if (!result.success) {
    return res
      .status(500)
      .render("error", { message: result.message, layout: "layouts/user" });
  }

  res.render("user/wallet", {
    layout: "layouts/user",
    path: "wallet",
    activePage: "wallet",
    balance: result.balance,
    transactions: result.transactions,
    pagination: result.pagination,
    razorpayKeyId: process.env.RAZORPAY_KEY_ID,
  });
});

// ─── POST /wallet/topup/create-order ─────────────────────────────────────────
// Creates a Razorpay order for wallet top-up (no DB side effects yet)
export const createTopupOrder = asyncHandler(async (req, res) => {
  const { amount } = req.body;
  const parsed = parseInt(amount);

  if (!parsed || parsed < 10 || parsed > 50000) {
    return res
      .status(400)
      .json({
        success: false,
        message: "Amount must be between ₹10 and ₹50,000",
      });
  }

  let rzpOrder;
  try {
    rzpOrder = await razorpay.orders.create({
      amount: parsed * 100, // paise
      currency: "INR",
      receipt: `wt_${req.session.user.id.toString().slice(-8)}_${Date.now().toString().slice(-8)}`,
    });
  } catch (err) {
    console.error("Wallet topup Razorpay order error:", err);
    return res
      .status(500)
      .json({
        success: false,
        message: "Payment gateway error. Please try again.",
      });
  }

  // Store in session for verification
  req.session.walletTopup = { razorpayOrderId: rzpOrder.id, amount: parsed };

  return res.json({
    success: true,
    razorpayOrderId: rzpOrder.id,
    amount: rzpOrder.amount,
    currency: rzpOrder.currency,
    keyId: process.env.RAZORPAY_KEY_ID,
  });
});

// ─── POST /wallet/topup/verify ────────────────────────────────────────────────
// Verifies Razorpay signature → credits wallet
export const verifyTopup = asyncHandler(async (req, res) => {
  const userId = req.session.user.id;
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } =
    req.body;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res
      .status(400)
      .json({ success: false, message: "Missing payment details" });
  }

  const pending = req.session.walletTopup;
  if (!pending || pending.razorpayOrderId !== razorpay_order_id) {
    return res
      .status(400)
      .json({
        success: false,
        message: "Invalid top-up session. Please try again.",
      });
  }

  // Verify HMAC-SHA256 signature
  const expected = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest("hex");

  if (expected !== razorpay_signature) {
    delete req.session.walletTopup;
    return res
      .status(400)
      .json({ success: false, message: "Payment verification failed." });
  }

  // Credit wallet
  const result = await creditWalletService({
    userId,
    amount: pending.amount,
    description: `Wallet top-up via Razorpay`,
    category: "topup",
  });

  delete req.session.walletTopup;

  if (!result.success) {
    return res.status(500).json({ success: false, message: result.message });
  }

  return res.json({
    success: true,
    message: `₹${pending.amount.toLocaleString("en-IN")} added to your wallet successfully!`,
    newBalance: result.balance,
  });
});
