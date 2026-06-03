import User from "../../models/user.model.js";
import asyncHandler from "../../utils/asyncHandler.util.js";
import { sendOTP } from "../../utils/sendOtp.util.js";
import bcrypt from 'bcrypt';


// Show Page - Stays a standard GET render
export const showChangePassword = asyncHandler(async (req, res) => {

    const user = await User.findById(req.session.user.id);
    if (!user || user.googleId) return res.redirect("/profile");
   
    return res.render("user/change-password",{ layout: "layouts/user", user });
});





export const handleChangePassword = asyncHandler(async (req, res) => {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    
    // 1. Basic Presence Validation
    if (!currentPassword || !newPassword || !confirmPassword) {
        return res.status(400).json({ success: false, message: "All fields are required" });
    }

    // 2. NEW: Complexity Validation (Regex)
    // Min 8 chars, 1 Uppercase, 1 Number, 1 Special Character
    const passwordRegex = /^(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
    
    if (!passwordRegex.test(newPassword)) {
        return res.status(400).json({ 
            success: false, 
            message: "Password must be at least 8 characters and include an uppercase letter, a number, and a special character (@$!%*?&)." 
        });
    }

    // 3. Logic Checks
    if (newPassword !== confirmPassword) {
        return res.status(400).json({ success: false, message: "New passwords do not match" });
    }

    if (currentPassword === newPassword) {
        return res.status(400).json({ success: false, message: "New password cannot be the same as the current password" });
    }

    // 4. Database Check
    const userId = req.session?.user?.id; 
    if (!userId) {
        return res.status(401).json({ success: false, message: "Session expired. Please log in again." });
    }

    const user = await User.findById(userId);
    if (!user) {
        return res.status(404).json({ success: false, message: "User not found" });
    }

    // 5. Password Verification
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
        return res.status(401).json({ success: false, message: "The current password you entered is incorrect" });
    }

    // 6. Update Password
    const hashedPassword = await bcrypt.hash(newPassword, 12);
    user.password = hashedPassword;
    user.passwordChangedAt = Date.now();
    await user.save();

    return res.status(200).json({ success: true, message: "Password changed successfully" });
});
// Authenticated Forgot Password (AJAX)
export const handleAuthForgotPassword = asyncHandler(async (req, res) => {
    // Use the ID from the session where you stored it during login
    const userId = req.session?.user?.id;
  
    if (!userId) {
        return res.status(401).json({ success: false, message: "Session expired" });
    }

    const user = await User.findById(userId);

    // Check against your ACTUAL model fields (isEmailVerified vs isVerified)
    if (!user || user.isBlocked || !user.password) {
        return res.status(403).json({ 
            success: false, 
            message: "This account cannot reset password via OTP." 
        });
    }

    // Send the OTP
    await sendOTP(user.email, "FORGOT_PASSWORD");

    // Important: Set these session variables so the verify-otp page works
    req.session.email = user.email;
    req.session.otpPurpose = "FORGOT_PASSWORD";

    // Return success AND the redirect path for the frontend
    return res.status(200).json({ 
        success: true, 
        message: "An OTP has been sent to your registered email",
        redirect: "/verify-otp" // The frontend needs this!
    });
});
