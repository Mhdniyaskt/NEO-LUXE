import express from "express";

import * as authController from "../controllers/user/auth.controller.js";
import * as otpController from "../controllers/user/otp.controller.js";
import * as profileController from "../controllers/user/profile.controller.js";
import * as emailController from "../controllers/user/profile.change.email.controller.js";
import * as addressController from "../controllers/user/address.controller.js";
import * as passwordController from "../controllers/user/profile.change.password.controller.js";

import {
  checkUser,
  checkUserStatus,
  redirectIfAuthenticated,
  requireAuth,
} from "../middleware/auth.middleware.js";
import { requireOtpSession } from "../middleware/otp.middleware.js";
import { noCache } from "../middleware/nocache.middleware.js";
import { upload } from "../middleware/upload.middleware.js";
import { getProductDetails, getProducts } from "../controllers/user/shop.controller.js";
import { getAbout } from "../controllers/user/about.controller.js";
import { addToCart, getCart, removeFromCart, updateQty, clearCart } from "../controllers/user/cart.controller.js";
import {
  getCheckout, placeOrder, getBuyNow, placeBuyNowOrder,
  getOrderConfirmation, downloadInvoice, createRazorpayOrder,
  verifyRazorpayPayment, handleRazorpayFailure, applyCoupon, removeCoupon,
} from "../controllers/user/checkout.controller.js";
import {
  getOrders, getOrderDetails, cancelOrder, returnOrder,
  cancelOrderItem, returnOrderItem, getPaymentFailed,
} from "../controllers/user/order.controller.js";
import {
  getWishlist, toggleWishlist, removeFromWishlist, moveToCart, getWishlistIds,
} from "../controllers/user/wishlist.controller.js";
import { getWallet, createTopupOrder, verifyTopup } from "../controllers/user/wallet.controller.js";
import { getReferralPage } from "../controllers/user/referral.controller.js";

const router = express.Router();

router.use(checkUserStatus);

// ═══ HOME ═══
router.get("/", checkUser, noCache, authController.loadHome);

// ═══ AUTH ═══
router.route("/signup")
  .get(noCache, redirectIfAuthenticated, authController.loadSignup)
  .post(authController.handleSignup);

router.route("/login")
  .get(noCache, redirectIfAuthenticated, authController.loadLogin)
  .post(authController.handleLogin);

router.post("/logout", authController.logout);

router.route("/verify-otp")
  .get(noCache, requireOtpSession, otpController.showVerifyOTP)
  .post(otpController.verifyOTP);

router.post("/resend-otp", otpController.resendOTP);

router.route("/forgot-password")
  .get(noCache, authController.showForgotPassword)
  .post(authController.handleForgotPassword);

router.route("/reset-password")
  .get(noCache, authController.showResetPassword)
  .post(authController.handleResetPassword);

// ═══ PROFILE ═══
router.get("/profile", noCache, requireAuth, profileController.showProfile);

router.route("/editprofile")
  .get(requireAuth, profileController.showEditProfile)
  .post(requireAuth, profileController.updateProfile);

router.route("/profile/photo")
  .post(requireAuth, upload.single("profilePhoto"), profileController.uploadProfilePhoto)
  .delete(requireAuth, profileController.removeProfilePhoto);

router.route("/profile/change-email")
  .get(requireAuth, emailController.showChangeEmail)
  .post(requireAuth, emailController.requestEmailChange);

router.route("/profile/verify-email-change")
  .get(requireAuth, emailController.showVerifyEmailChangeOTP)
  .post(requireAuth, emailController.verifyEmailChangeOTP);

router.post("/profile/resend-email-change-otp", requireAuth, emailController.resendEmailChangeOTP);

router.route("/profile/change-password")
  .get(noCache, requireAuth, passwordController.showChangePassword)
  .post(noCache, requireAuth, passwordController.handleChangePassword);

// ═══ ADDRESSES ═══
router.route("/addresses")
  .get(noCache, requireAuth, addressController.showAddressManagement)
  .post(requireAuth, addressController.addAddress);

router.patch("/addresses/:addressId/default", requireAuth, addressController.setDefaultAddress);

router.route("/addresses/:addressId")
  .put(requireAuth, addressController.updateAddress)
  .delete(requireAuth, addressController.deleteAddress);

// ═══ SHOP ═══
router.get("/about", getAbout);
router.get("/shop", getProducts);
router.get("/shop/:id", getProductDetails);

// ═══ CART ═══
router.route("/cart")
  .get(requireAuth, getCart)
  .post(addToCart)
  .delete(requireAuth, clearCart);

router.delete("/cart/:variantId", requireAuth, removeFromCart);
router.patch("/cart/update-qty", requireAuth, updateQty);

// ═══ CHECKOUT ═══
router.route("/checkout")
  .get(requireAuth, noCache, getCheckout);

router.post("/checkout/place-order", requireAuth, placeOrder);
router.post("/checkout/razorpay/create-order", requireAuth, createRazorpayOrder);
router.post("/checkout/razorpay/verify", requireAuth, verifyRazorpayPayment);
router.post("/checkout/razorpay/failed", requireAuth, handleRazorpayFailure);
router.post("/checkout/apply-coupon", requireAuth, applyCoupon);
router.post("/checkout/remove-coupon", requireAuth, removeCoupon);

// ═══ BUY NOW ═══
router.get("/buy-now/:productId/:variantId", requireAuth, noCache, getBuyNow);
router.post("/buy-now/place-order", requireAuth, placeBuyNowOrder);

// ═══ ORDERS ═══
router.get("/payment-failed", requireAuth, noCache, getPaymentFailed);
router.get("/orders", requireAuth, noCache, getOrders);
router.get("/orders/:orderId", requireAuth, noCache, getOrderConfirmation);
router.get("/orders/:orderId/details", requireAuth, noCache, getOrderDetails);
router.get("/orders/:orderId/invoice", requireAuth, downloadInvoice);
router.post("/orders/:orderId/cancel", requireAuth, cancelOrder);
router.post("/orders/:orderId/return", requireAuth, returnOrder);
router.post("/orders/:orderId/items/:itemIndex/cancel", requireAuth, cancelOrderItem);
router.post("/orders/:orderId/items/:itemIndex/return", requireAuth, returnOrderItem);

// ═══ WISHLIST ═══
router.get("/user/wishlist", requireAuth, noCache, getWishlist);
router.get("/user/wishlist/ids", getWishlistIds);
router.post("/user/wishlist/toggle", toggleWishlist);
router.post("/user/wishlist/move-to-cart", requireAuth, moveToCart);
router.delete("/user/wishlist/:variantId", requireAuth, removeFromWishlist);

// ═══ WALLET ═══
router.get("/wallet", requireAuth, noCache, getWallet);
router.post("/wallet/topup/create-order", requireAuth, createTopupOrder);
router.post("/wallet/topup/verify", requireAuth, verifyTopup);

// ═══ REFERRAL ═══
router.get("/referral", requireAuth, noCache, getReferralPage);

export default router;
