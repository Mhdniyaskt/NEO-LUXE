import User from "../../models/user.model.js";
import crypto from "crypto";
import OTP from "../../models/otp.model.js";
import asyncHandler from "../../utils/asyncHandler.util.js";
import { sendOTP } from "../../utils/sendOtp.util.js";

// 1. Show Change Email Page
export const showChangeEmail = asyncHandler(async (req, res) => {
    const user = await User.findById(req.session.user.id);
    if (!user || user.googleId) return res.redirect("/profile");
    res.render("user/change-email", { layout: "layouts/user", user, path: '/profile' });
});

// 2. Request Change & Send OTP
export const requestEmailChange = asyncHandler(async (req, res) => {
    const { newEmail } = req.body;
    const user = await User.findById(req.session.user.id);
    const normalizedEmail = newEmail.trim().toLowerCase();

    if (normalizedEmail === user.email) return res.json({ success: false, message: "New email must be different." });

    const exists = await User.findOne({ email: normalizedEmail });
    if (exists) return res.json({ success: false, message: "Email already in use." });

    user.pendingEmail = normalizedEmail;
    await user.save();

    await sendOTP(normalizedEmail, "EMAIL_CHANGE");
    res.json({ success: true, message: "OTP sent!", redirect: "/profile/verify-email-change" });
});

// 3. Show the 6-Digit Verification Page
export const showVerifyEmailChangeOTP = asyncHandler(async (req, res) => {
    const user = await User.findById(req.session.user.id);
    if (!user || !user.pendingEmail) return res.redirect("/profile/change-email");

    res.render("user/otp-verify-page", {
        layout: "layouts/user",
        actionUrl: "/profile/verify-email-change",
        resendUrl: "/profile/resend-email-change-otp",
        path: '/profile'
    });
});

// 4. Verify 6-Digit OTP
export const verifyEmailChangeOTP = asyncHandler(async (req, res) => {
    const { otp } = req.body; 
    const user = await User.findById(req.session.user.id);

    if (!user || !user.pendingEmail) return res.json({ success: false, message: "Session expired." });

    const otpRecord = await OTP.findOne({ email: user.pendingEmail, purpose: "EMAIL_CHANGE" }).sort({ createdAt: -1 });
    if (!otpRecord) return res.json({ success: false, message: "OTP expired." });

    const hashedOtp = crypto.createHash("sha256").update(otp).digest("hex");
    if (otpRecord.otp !== hashedOtp) {
        otpRecord.attempts += 1;
        await otpRecord.save();
        return res.json({ success: false, message: "Invalid OTP code." });
    }

    user.email = user.pendingEmail;
    user.pendingEmail = undefined;
    await user.save();
    req.session.user.email = user.email;
    await OTP.deleteMany({ email: user.email, purpose: "EMAIL_CHANGE" });

    res.json({ success: true, message: "Email updated!", redirect: "/profile" });
});

// 5. Resend OTP Logic
export const resendEmailChangeOTP = asyncHandler(async (req, res) => {
    const user = await User.findById(req.session.user.id);
    if (!user?.pendingEmail) return res.status(400).json({ success: false, message: "No request found." });

    await sendOTP(user.pendingEmail, "EMAIL_CHANGE");
    res.json({ success: true, message: "OTP Resent!" });
});