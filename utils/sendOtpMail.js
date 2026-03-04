import crypto from "crypto";
import nodemailer from "nodemailer";
import OTP from "../models/EmailOtp.js";
import AppError from "./appError.js";
import { HTTP_STATUS } from "../constants/httStatus.js";


const emailTemplates = {
  SIGNUP: {
    subject: "Verify your email",
    body: (otp) => `
      <p>Your signup OTP is <strong>${otp}</strong></p>
      <p>Valid for 5 minutes.</p>
    `
  },
  FORGOT_PASSWORD: {
    subject: "Reset your password",
    body: (otp) => `
      <p>Your password reset OTP is <strong>${otp}</strong></p>
      <p>Valid for 5 minutes.</p>
    `
  },
  EMAIL_CHANGE: {
    subject: "Confirm your new email",
    body: (otp) => `
      <p>Use this OTP to confirm your email change:</p>
      <strong>${otp}</strong>
    `
  }
};

export const sendOTP = async (email, purpose) => {
  try {
    // Rate limiting
    const recentOTP = await OTP.findOne({
      email,
      purpose,
      createdAt: { $gte: new Date(Date.now() - 30 * 1000) }
    });

    if (recentOTP) {
      throw new AppError(
        "Please wait before requesting another OTP",
        HTTP_STATUS.TOO_MANY_REQUESTS
      );
    }

    // Generate OTP
    const otp = crypto.randomInt(100000, 999999).toString();
    const hashedOtp = crypto
      .createHash("sha256")
      .update(otp)
      .digest("hex");

    await OTP.deleteMany({ email, purpose });

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: emailTemplates[purpose].subject,
      html: emailTemplates[purpose].body(otp)
    });

    await OTP.create({
      email,
      otp: hashedOtp,
      purpose
    });

    return true;

  } catch (error) {
    //  IMPORTANT PART
    console.error("OTP sending failed:", error);

    // If it's already a known AppError (rate limit), rethrow it
    if (error instanceof AppError) {
      throw error;
    }

    // Otherwise, hide internal details and throw a generic OTP failure
    throw new AppError(
      "Failed to send OTP. Please try again.",
      HTTP_STATUS.BAD_REQUEST
    );
  }
};