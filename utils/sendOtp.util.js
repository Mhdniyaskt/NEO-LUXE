import crypto from "crypto";
import nodemailer from "nodemailer";
import OTP from "../models/otp.model.js";
import AppError from "./appError.util.js";

const emailTemplates = {
  // Matching the session string "SIGNUP"
  SIGNUP: {
    subject: "Verify Your Email | NEO-LUXE",
    body: (otp) => `<h2>Security Verification</h2><p>Your signup code is: <strong>${otp}</strong></p>`
  },
  // Matching the session string "password_reset" from handleForgotPassword
  password_reset: {
    subject: "Reset Your Password | NEO-LUXE",
    body: (otp) => `<h2>Password Reset Request</h2><p>Your reset code is: <strong>${otp}</strong></p>`
  },
  // Added as a backup just in case
  FORGOT_PASSWORD: {
    subject: "Reset Your Password | NEO-LUXE",
    body: (otp) => `<h2>Password Reset Request</h2><p>Your reset code is: <strong>${otp}</strong></p>`
  }
,
  EMAIL_CHANGE: {
    subject: "Confirm Your New Email | NEO-LUXE",
    body: (otp) => `<h2>Email Change Request</h2><p>Your verification code is: <strong>${otp}</strong></p>`
  }
};

export const sendOTP = async (email, purpose) => {
  try {
    const recentOTP = await OTP.findOne({
      email,
      purpose,
      createdAt: { $gte: new Date(Date.now() - 30 * 1000) }
    });

    if (recentOTP) {
      throw new AppError("Please wait 30 seconds before requesting another OTP", 429);
    }

    // CRITICAL FIX: Check if purpose exists in templates
    if (!emailTemplates[purpose]) {
      console.error(`ERROR: Purpose "${purpose}" not found in emailTemplates.`);
      throw new AppError("Invalid email request purpose.", 400);
    }

    const otp = crypto.randomInt(100000, 999999).toString();
    const hashedOtp = crypto.createHash("sha256").update(otp).digest("hex");

    await OTP.deleteMany({ email, purpose });

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

    await transporter.sendMail({
      from: `"NEO-LUXE" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: emailTemplates[purpose].subject,
      html: emailTemplates[purpose].body(otp)
    });

    await OTP.create({ email, otp: hashedOtp, purpose });
    return true;

  } catch (error) {
    if (error.isOperational || error instanceof AppError) throw error;
    console.error("OTP System Failure:", error);
    throw new AppError("Failed to deliver OTP. Please try again.", 400);
  }
};