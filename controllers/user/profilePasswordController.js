import User from "../../models/userModel.js";
import asyncHandler from "../../utils/asyncHandler.js";
import { sendOTP } from "../../utils/sendOtpMail.js";

import bcrypt from "bcrypt";

// Show Page - Stays a standard GET render
export const showChangePassword = asyncHandler(async (req, res) => {
    const user = await User.findById(req.session.user.id);
    if (!user.password && user.googleId) {
       
        return res.redirect("/profile");
    }
    return res.render("user/change-password");
});

export const handleChangePassword = asyncHandler(async (req, res) => {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    
    // 1. Validation
    if (!currentPassword || !newPassword || !confirmPassword) {
        return res.status(400).json({ success: false, message: "All fields are required" });
    }

    if (newPassword.length <= 8) {
        return res.status(400).json({ success: false, message: "Password must be at least 6 characters" });
    }

    if (newPassword !== confirmPassword) {
        return res.status(400).json({ success: false, message: "Passwords do not match" });
    }

    if (currentPassword === newPassword) {
        return res.status(400).json({ success: false, message: "Current and New password cannot be the same" });
    }

    // 2. Database Check
    // Note: Assuming your auth middleware sets req.session.user.id
    const userId = req.session.user.id; 
    const user = await User.findById(userId);

    if (!user) {
        return res.status(404).json({ success: false, message: "User not found" });
    }

    // 3. Password Verification
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
        return res.status(401).json({ success: false, message: "Current password is incorrect" });
    }

    // 4. Update Password
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;
    user.passwordChangedAt = new Date();
    await user.save();

    // With Sessions, you don't need to re-issue cookies. 
    // The session stays active unless you explicitly destroy it.
    return res.status(200).json({ success: true, message: "Password Changed Successfully" });
});

// Authenticated Forgot Password (AJAX)
export const handleAuthForgotPassword = asyncHandler(async (req, res) => {
    const user = await User.findById(req.user.userId);

    if (!user || !user.isVerified || user.isBlocked || !user.password) {
        return res.status(403).json({ success: false, message: "Unable to process password reset" });
    }

    await sendOTP(user.email, "FORGOT_PASSWORD");

    req.session.email = user.email;
    req.session.otpPurpose = "FORGOT_PASSWORD";

    return res.status(200).json({ success: true, message: "An OTP has been sent to your registered email" });
});