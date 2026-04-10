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
  handleResetPassword,
} from "../controllers/user/authController.js";
import {
  showVerifyOTP,
  verifyOTP,
  resendOTP,
} from "../controllers/user/verifyOtpController.js";

import {
  removeProfilePhoto,
  showEditProfile,
  showProfile,
  updateProfile,
  uploadProfilePhoto,
} from "../controllers/user/profileController.js";
import {
  checkUser,
  redirectIfAuthenticated,
  requireAuth,
} from "../middleware/auth.middleware.js";

import { requireOtpSession } from "../middleware/otp.middleware.js";
import { noCache } from "../middleware/cache.middleware.js";
import { upload } from "../middleware/upload.middleware.js";
import {
  requestEmailChange,
  resendEmailChangeOTP,
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

router.get("/", checkUser,noCache, loadHome);

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

router.post("/logout", logout);

router.get("/forgot-password", noCache, showForgotPassword);
router.post("/forgot-password", handleForgotPassword);

router.get("/reset-password", noCache, showResetPassword);
router.post("/reset-password", handleResetPassword);

router.get("/profile", noCache, requireAuth, showProfile);
router.post("/profile/upload-photo", upload.single("profilePhoto"), uploadProfilePhoto);

// Remove Profile Photo
router.delete("/profile/remove-photo",requireAuth, removeProfilePhoto);

router.get("/profile/change-email", requireAuth, showChangeEmail);
router.post("/profile/change-email", requireAuth, requestEmailChange);

router.get("/profile/verify-email-change", requireAuth, showVerifyEmailChangeOTP);
router.post("/profile/verify-email-change", requireAuth, verifyEmailChangeOTP);
router.post("/profile/resend-email-change-otp", requireAuth, resendEmailChangeOTP);
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
// router.get(
//   "/forgot-password/authenticated",
//   noCache,
//   requireAuth,
//   handleAuthForgotPassword,
// );

router.get("/editprofile",requireAuth,showEditProfile)
router.post("/profile/update",requireAuth,updateProfile)
router.get("/addresses", noCache, requireAuth, showAddressManagement);
router.post("/addresses/add", requireAuth, addAddress);


router.post("/addresses/edit/:addressId", requireAuth, updateAddress);

router.get("/addresses/delete/:addressId", requireAuth, deleteAddress);

export default router;
