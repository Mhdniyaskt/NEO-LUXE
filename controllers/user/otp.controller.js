import OTP from "../../models/otp.model.js";
import User from "../../models/user.model.js";
import crypto from "crypto";
import { sendOTP } from "../../utils/sendOtp.util.js";
import { HTTP_STATUS } from "../../constants/http-status.constant.js";
import asyncHandler from "../../utils/asyncHandler.util.js";


export const showVerifyOTP = (req, res) => {
    // If purpose is gone, they shouldn't be here (either finished or timed out)
    if (!req.session.otpPurpose || !req.session.email) {
        return res.redirect("/forgot-password");
    }

    return res.render("user/otp-verify-page", {
        layout: "layouts/user",
        actionUrl: "/verify-otp",
        resendUrl: "/resend-otp",
    });
};

export const verifyOTP = asyncHandler(async (req, res) => {
    const email = req.session.email;
    const purpose = req.session.otpPurpose;

    if (!email || !purpose) {
        return res.status(400).json({
            success: false,
            message: "Session expired. Please restart the process."
        });
    }

    const { otp } = req.body;
    const otpRecord = await OTP.findOne({ email, purpose }).sort({ createdAt: -1 });

    if (!otpRecord) {
        return res.json({ success: false, message: "OTP invalid or expired" });
    }

    // Attempt Limit Logic
    if (otpRecord.attempts >= 5) {
        await OTP.deleteOne({ _id: otpRecord._id });
        return res.json({ success: false, message: "Too many attempts. Request new OTP." });
    }

    const hashedOtp = crypto.createHash("sha256").update(otp).digest("hex");

    if (otpRecord.otp !== hashedOtp) {
        otpRecord.attempts += 1;
        await otpRecord.save();
        return res.json({
            success: false,
            message: `OTP incorrect. ${5 - otpRecord.attempts} attempts remaining`
        });
    }

    // --- LOGIC PER PURPOSE ---

  
  


    if (purpose === "SIGNUP") {
        const user = await User.findOneAndUpdate({ email }, { isEmailVerified: true }, { new: true });
        await OTP.deleteMany({ email, purpose });

        // Process referral if a code was provided during signup
        if (req.session.pendingReferralCode && user) {
          const { processReferral, generateReferralCode } = await import('../../services/referral.service.js');
          await processReferral(user._id, req.session.pendingReferralCode);
          await generateReferralCode(user._id);
          delete req.session.pendingReferralCode;
        } else if (user) {
          // Generate referral code for new user even without referral
          const { generateReferralCode } = await import('../../services/referral.service.js');
          await generateReferralCode(user._id);
        }

        return res.json({ success: true, redirect: "/login", message: "Email verified!" });
    }

    // Check for both possible reset strings
    if (purpose === "FORGOT_PASSWORD" || purpose === "password_reset") {
        req.session.allowPasswordReset = true;

          delete req.session.otpPurpose; 
        await OTP.deleteMany({ email, purpose }); // Clean up after success
        return res.json({ success: true, redirect: "/reset-password" });
    }
});

export const resendOTP = async (req, res) => {
    try {
        const email = req.session?.email;
        const purpose = req.session?.otpPurpose;

        // 1. Session Validation
        if (!email || !purpose) {
            return res.status(400).json({
                success: false, 
                message: "Session expired. Please restart the process." 
            });
        }

        // 2. Execute Send (Wait for utility)
        await sendOTP(email, purpose);

        // 3. Dynamic Success Messages
        let displayMessage = "A fresh security code has been sent to your email.";
        
        // Matching your logic: Ensure purpose string matches exactly what you set in session
        if (purpose === "FORGOT_PASSWORD" || purpose === "password_reset") {
            displayMessage = "If an account exists, a new security code has been sent.";
        }

        return res.status(200).json({
            success: true,
            message: displayMessage
        });

    } catch (error) {
        console.error("Resend Controller Error:", error.message);

        // 4. Return specific error (like 429 Too Many Requests) or 500
        const statusCode = error.statusCode || 500;
        
        return res.status(statusCode).json({
            success: false,
            message: error.message || "An unexpected error occurred. Please try again later."
        });
    }
};