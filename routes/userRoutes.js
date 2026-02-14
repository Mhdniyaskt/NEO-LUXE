import express from "express";
import {getChangeEmail, getChangePassword, getEditProfile, getProfile, getResetPassword, loadHome,loadLogin,loadSignup,postLogin,signupSubmit}from "../controllers/user/userController.js"
import { getVerifyEmail, resendOtp, verifyEmail } from "../controllers/user/verifyOtpController.js";

const router=express.Router()


router.get("/",loadHome)

router.get("/signup",loadSignup)
router.post("/signup",signupSubmit)



router.get("/login",loadLogin)
router.post("/login",postLogin)

router.get("/myprofile",getProfile)
router.get("/editprofile",getEditProfile)

router.get("/verify-email",getVerifyEmail)
router.post("/verify-email", verifyEmail);
router.post("/resend-otp", resendOtp);


router.get("/changeEmail",getChangeEmail)
router.get("/changePass",getChangePassword)
router.get("/resetPass",getResetPassword)


export default router;