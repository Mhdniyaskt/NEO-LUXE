import express from "express";
import {
  loadHome,
  loadSignup,
  handleSignup,
  loadLogin,
  handleLogin,
  logout,
  showForgotPassword,
  handleForgotPassword,
  showResetPassword,
} from "../controllers/user/authController.js";
import {
  showVerifyOTP,
  verifyOTP,
  resendOTP,
} from "../controllers/user/verifyOtpController.js";

import {
  removeProfilePhoto,
  showProfile,
  uploadProfilePhoto,
} from "../controllers/user/profileController.js";
import {
  redirectIfAuthenticated,
  requireAuth,
} from "../middleware/auth.middleware.js";

import { requireOtpSession } from "../middleware/otp.middleware.js";
import { noCache } from "../middleware/cache.middleware.js";
import { upload } from "../middleware/upload.middleware.js";
import {
  requestEmailChange,
  showChangeEmail,
  showVerifyEmailChangeOTP,
  verifyEmailChangeOTP,
} from "../controllers/user/profileEmailController.js";
import {
  addAddress,
  deleteAddress,
  showAddressManagement,
  updateAddress,
} from "../controllers/user/addressController.js";
import { handleAuthForgotPassword, handleChangePassword, showChangePassword } from "../controllers/user/profilePasswordController.js";

const router = express.Router();

router.get("/", noCache, loadHome);

router
  .route("/signup")
  .get(noCache, redirectIfAuthenticated, loadSignup)
  .post(handleSignup);

router
  .route("/verify-otp")
  .get(noCache, requireOtpSession, showVerifyOTP)
  .post(verifyOTP);

router.post("/resend-otp", resendOTP);

router.get("/login", noCache, redirectIfAuthenticated, loadLogin);
router.post("/login", handleLogin);

router.get("/logout", noCache, logout);

router.get("/forgot-password", noCache, showForgotPassword);
router.post("/forgot-password", handleForgotPassword);

router.get("/reset-password", noCache, showResetPassword);
router.post("/reset-password", handleForgotPassword);

router.get("/profile", noCache, requireAuth, showProfile);

router.post(
  "/profile/upload-photo",
  requireAuth,
  upload.single("profilePhoto"),
  uploadProfilePhoto,
);
router.delete("/profile/remove-photo", requireAuth, removeProfilePhoto);

router.get("/profile/change-email", noCache, requireAuth, showChangeEmail);
router.post("/profile/change-email", requireAuth, requestEmailChange);

router.get(
  "/profile/verify-email-change",
  noCache,
  requireAuth,
  showVerifyEmailChangeOTP,
);
router.post("/profile/verify-email-change", requireAuth, verifyEmailChangeOTP);

router.get(
  "/profile/change-password",
  noCache,
  requireAuth,
  showChangePassword,
);
router.post(
  "/profile/change-password",
  noCache,
  requireAuth,
  handleChangePassword,
);
router.get(
  "/forgot-password/authenticated",
  noCache,
  requireAuth,
  handleAuthForgotPassword,
);

/* Address Management */

router.get("/addresses", noCache, requireAuth, showAddressManagement);
router.post("/addresses/add", requireAuth, addAddress);

// Use POST for update to handle the form submission easily from EJS
router.post("/addresses/edit/:addressId", requireAuth, updateAddress);

// Changed to GET for the simple window.location.href delete logic
router.get("/addresses/delete/:addressId", requireAuth, deleteAddress);

export default router;
