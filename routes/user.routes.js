import express from "express";

import * as authController from "../controllers/user/auth.controller.js";
import * as otpController from "../controllers/user/otp.controller.js";
import * as profileController from "../controllers/user/profile.controller.js";
import * as emailController from "../controllers/user/profile.change.email.controller.js";
import * as addressController from "../controllers/user/address.controller.js";import * as passwordController from "../controllers/user/profile.change.password.controller.js";

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
import { addToCart, getCart, removeFromCart, updateQty } from "../controllers/user/cart.controller.js";
import {
  getCheckout,
  placeOrder,
  buyNow,
  getOrderConfirmation,
  getOrders,
} from "../controllers/user/checkout.controller.js";

const router = express.Router();

router.use(checkUserStatus);

router.get("/", checkUser, noCache, authController.loadHome);

router
  .route("/signup")
  .get(noCache, redirectIfAuthenticated, authController.loadSignup)
  .post(authController.handleSignup);

router
  .route("/login")
  .get(noCache, redirectIfAuthenticated, authController.loadLogin)
  .post(authController.handleLogin);

router.post("/logout", authController.logout);

router
  .route("/verify-otp")
  .get(noCache, requireOtpSession, otpController.showVerifyOTP)
  .post(otpController.verifyOTP);

router.post("/resend-otp", otpController.resendOTP);

router
  .route("/forgot-password")
  .get(noCache, authController.showForgotPassword)
  .post(authController.handleForgotPassword);

router
  .route("/reset-password")
  .get(noCache, authController.showResetPassword)
  .post(authController.handleResetPassword);

router.get("/profile", noCache, requireAuth, profileController.showProfile);

router
  .route("/editprofile")
  .get(requireAuth, profileController.showEditProfile)
  .post(requireAuth, profileController.updateProfile);

router.post(
  "/profile/photo",
  requireAuth,
  upload.single("profilePhoto"),
  profileController.uploadProfilePhoto,
);

router.delete(
  "/profile/photo",
  requireAuth,
  profileController.removeProfilePhoto,
);

router
  .route("/profile/change-email")
  .get(requireAuth, emailController.showChangeEmail)
  .post(requireAuth, emailController.requestEmailChange);

router
  .route("/profile/verify-email-change")
  .get(requireAuth, emailController.showVerifyEmailChangeOTP)
  .post(requireAuth, emailController.verifyEmailChangeOTP);

router.post(
  "/profile/resend-email-change-otp",
  requireAuth,
  emailController.resendEmailChangeOTP,
);

router
  .route("/profile/change-password")
  .get(noCache, requireAuth, passwordController.showChangePassword)
  .post(noCache, requireAuth, passwordController.handleChangePassword);

router.get(
  "/addresses",
  noCache,
  requireAuth,
  addressController.showAddressManagement,
);

router.post("/addresses", requireAuth, addressController.addAddress);

// /default must be registered BEFORE /:addressId to avoid route shadowing
router.patch("/addresses/:addressId/default", requireAuth, addressController.setDefaultAddress);

router
  .route("/addresses/:addressId")
  .put(requireAuth, addressController.updateAddress)
  .delete(requireAuth, addressController.deleteAddress);

router.get("/about", getAbout);
router.get("/shop", getProducts);
router.get("/shop/:id", getProductDetails);


 
router.get('/cart',                          requireAuth, getCart);
router.post('/cart/add',                     addToCart);          // addToCart handles its own 401 JSON response
router.delete('/cart/remove/:variantId',     requireAuth, removeFromCart);
router.patch('/cart/update-qty',             requireAuth, updateQty);

// Checkout & Orders
router.get('/checkout',                      requireAuth, noCache, getCheckout);
router.post('/checkout/place-order',         requireAuth, placeOrder);
router.post('/checkout/buy-now',             requireAuth, buyNow);
router.get('/orders',                        requireAuth, noCache, getOrders);
router.get('/orders/:orderId',               requireAuth, noCache, getOrderConfirmation);

export default router;
