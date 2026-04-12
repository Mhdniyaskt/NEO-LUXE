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
} from "../middleware/user/auth.middleware.js";
import { requireOtpSession } from "../middleware/user/otp.middleware.js";
import { noCache } from "../middleware/user/cache.middleware.js";
import { upload } from "../middleware/user/upload.middleware.js";

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
  .route("/profile/update")
  .get(requireAuth, profileController.showEditProfile)
  .post(requireAuth, profileController.updateProfile);


router.post(
  "/profile/photo",
  requireAuth,
  upload.single("profilePhoto"),
  profileController.uploadProfilePhoto
);

router.delete(
  "/profile/photo",
  requireAuth,
  profileController.removeProfilePhoto
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
  emailController.resendEmailChangeOTP
);



router
  .route("/profile/change-password")
  .get(noCache, requireAuth, passwordController.showChangePassword)
  .post(noCache, requireAuth, passwordController.handleChangePassword);



router.get(
  "/addresses",
  noCache,
  requireAuth,
  addressController.showAddressManagement
);

router.post(
  "/addresses",
  requireAuth,
  addressController.addAddress
);

router
  .route("/addresses/:addressId")
  .post(requireAuth, addressController.updateAddress)
  .delete(requireAuth, addressController.deleteAddress);


export default router;