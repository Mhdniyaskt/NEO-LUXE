import express from "express";
import {loadHome,loadSignup,handleSignup, loadLogin,  handleLogin, logout, showForgotPassword, handleForgotPassword, showResetPassword}from "../controllers/user/authController.js"
import { showVerifyOTP,verifyOTP,resendOTP } from "../controllers/user/verifyOtpController.js";

import{showProfile, uploadProfilePhoto}from"../controllers/user/profileController.js"
import { redirectIfAuthenticated, requireAuth } from "../middleware/auth.middleware.js";

import { requireOtpSession } from "../middleware/otp.middleware.js";
import { noCache } from "../middleware/cache.middleware.js";
import { upload } from "../middleware/upload.middleware.js";


const router=express.Router()


router.get("/",loadHome)

router.route("/signup")
.get(noCache,redirectIfAuthenticated,loadSignup)
.post(handleSignup)

router.route("/verify-otp")
.get(noCache,requireOtpSession,showVerifyOTP)
.post(verifyOTP)


router.post("/resend-otp", resendOTP);

 router.get("/login",loadLogin)
router.post("/login",handleLogin)

router.get('/logout',logout)


router.get("/profile", noCache,showProfile);


// router.get("/changeEmail",getChangeEmail)
 router.get("/forgot-password",showForgotPassword)
 router.post("/forgot-password",handleForgotPassword)

 router.get("/reset-password",showResetPassword)
  router.post("/reset-password",handleForgotPassword)
router.post("/profile/upload-photo", upload.single("profileImage"), uploadProfilePhoto);

export default router;