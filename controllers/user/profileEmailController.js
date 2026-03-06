import User from "../../models/userModel.js";
import crypto from "crypto";
import OTP from "../../models/EmailOtp.js";
import asyncHandler from "../../utils/asyncHandler.js";
import { sendOTP } from "../../utils/sendOtpMail.js";

// Change Email
export const showChangeEmail = asyncHandler(async (req, res) => {

  if (!req.session.user.id) {
    return res.redirect("/login");
  }

  const user = await User.findById(req.session.user.id);

  if (!user || user.googleId) {
    return res.redirect("/profile");
  }

  res.render("user/changeEmail", { layout: "layouts/user" });

});


export const requestEmailChange = asyncHandler(async (req, res) => {
  const { newEmail } = req.body;

  const user = await User.findById(req.session.user.id);

  if (!user) {
    return res.json({
      success: false,
      message: "User not found"
    });
  }

  if (!newEmail) {
    return res.json({
      success: false,
      message: "Please enter an email"
    });
  }

  const normalizedEmail = newEmail.trim().toLowerCase();

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!emailRegex.test(normalizedEmail)) {
    return res.json({
      success: false,
      message: "Enter a valid email address"
    });
  }

  if (normalizedEmail === user.email) {
    return res.json({
      success: false,
      message: "New email cannot be the same as current email"
    });
  }

  const emailExists = await User.findOne({ email: normalizedEmail });

  if (emailExists && emailExists.isVerified) {
    return res.json({
      success: false,
      message: "Email already in use"
    });
  }

  user.pendingEmail = normalizedEmail;
  await user.save();

  try {
    await sendOTP(normalizedEmail, "EMAIL_CHANGE");
  } catch (error) {
    return res.json({
      success: false,
      message: "Failed to send OTP. Try again"
    });
  }

  return res.json({
    success: true,
    message: "OTP sent to your email",
    redirect: "/profile/verify-email-change"
  });
});

export const showVerifyEmailChangeOTP = asyncHandler(async (req, res) => {

  const user = await User.findById(req.session.user.id);

  if (!user || !user.pendingEmail) {
    return res.json({
      success: false,
      message: "No email change request found",
      redirect: "/profile/change-email"
    });
  }

  return res.render("user/verifyEmail", {
    layout: "layouts/user",
    actionUrl: "/profile/verify-email-change",
    resendUrl: "/profile/resend-email-change-otp",
    title: "Verify Your New Email",
    subtitle: "Enter the OTP sent to your new email address",
  });

});



export const verifyEmailChangeOTP = asyncHandler(async (req, res) => {
  let { otp } = req.body;
console.log(req.body)
  otp = otp?.trim();

  if (!otp) {
    return res.json({
      success: false,
      message: "OTP is required",
    });
  }

  const user = await User.findById(req.session.user.id);

  if (!user || !user.pendingEmail) {
    return res.json({
      success: false,
      message: "No email change request found",
      redirect: "/profile/change-email",
    });
  }

  const email = user.pendingEmail;
  const purpose = "EMAIL_CHANGE";

  // Fetch latest OTP
  const otpRecord = await OTP.findOne({
    email,
    purpose,
  }).sort({ createdAt: -1 });

  // Too many attempts
  if (otpRecord?.attempts >= 5) {
    await OTP.deleteMany({ email, purpose });

    return res.json({
      success: false,
      message: "Too many failed attempts. Please request a new OTP",
      redirect: "/profile/change-email",
    });
  }

  // OTP not found
  if (!otpRecord) {
    return res.json({
      success: false,
      message: "OTP invalid or expired",
    });
  }

  // Hash and compare OTP
  const hashedOtp = crypto.createHash("sha256").update(otp).digest("hex");

  if (otpRecord.otp !== hashedOtp) {
    otpRecord.attempts += 1;
    await otpRecord.save();

    return res.json({
      success: false,
      message: `OTP invalid or expired. ${5 - otpRecord.attempts} attempts remaining`,
    });
  }

  // Update email
  user.email = user.pendingEmail;
  user.pendingEmail = undefined;
  user.isEmailVerified = true;
  await user.save();

  // Delete OTPs
  await OTP.deleteMany({ email, purpose });

  return res.json({
    success: true,
    message: "Email updated successfully",
    redirect: "/profile",
  });
});


export const resendEmailChangeOTP = asyncHandler(async (req, res) => {

  const user = await User.findById(req.session.user.id);

  if (!user || !user.pendingEmail) {
    return res.status(400).json({
      success: false,
      message: "No pending email change request found",
      redirect: "/profile/change-email"
    });
  }

  const email = user.pendingEmail;
  const purpose = "EMAIL_CHANGE";

  try {

    await sendOTP(email, purpose);

    return res.json({
      success: true,
      message: "New OTP sent to confirm your email change"
    });

  } catch (error) {

    return res.status(429).json({
      success: false,
      message: "Failed to send OTP. Please try again later"
    });

  }

});