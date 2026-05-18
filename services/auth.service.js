import User from "../models/user.model.js";
import bcrypt from "bcrypt";
import { sendOTP } from "../utils/sendOtp.util.js";
import { MESSAGES } from "../constants/messages.constant.js";

// ✅ HOME (no logic, just pass user)
export const homeService = async (user) => {
  return { success: true, user };
};

// ✅ SIGNUP
export const signupService = async (data) => {
  try {
    let { name, email, phoneNumber, password, confirmPassword, referralCode } = data;

    name = name?.trim();
    email = email?.trim().toLowerCase();
    phoneNumber = phoneNumber?.trim();
    password = password?.trim();
    confirmPassword = confirmPassword?.trim();

    // Required fields
    if (!name || !email || !phoneNumber || !password) {
      return { success: false, message: MESSAGES.GENERIC.ALL_FIELDS_REQUIRED };
    }

    // Name validation
    if (!/^[A-Za-z ]+$/.test(name)) {
      return { success: false, message: MESSAGES.VALIDATION.NAME_LETTERS_ONLY };
    }
    if (name.length < 3 || name.length > 30) {
      return { success: false, message: MESSAGES.VALIDATION.NAME_LENGTH };
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return { success: false, message: 'Please enter a valid email address' };
    }

    // Phone validation
    const phoneRegex = /^[6-9]\d{9}$/;
    if (!phoneRegex.test(phoneNumber)) {
      return { success: false, message: 'Phone number must be a valid 10-digit Indian number' };
    }

    // Password validation
    if (password.length < 8) {
      return { success: false, message: 'Password must be at least 8 characters' };
    }
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/;
    if (!passwordRegex.test(password)) {
      return { success: false, message: 'Password must contain uppercase, lowercase, number, and special character' };
    }

    // Confirm password match
    if (!confirmPassword) {
      return { success: false, message: 'Please confirm your password' };
    }
    if (password !== confirmPassword) {
      return { success: false, message: 'Password and confirm password do not match' };
    }

    // Check if email already exists
    const existingUser = await User.findOne({ email });

    if (existingUser?.googleId && !existingUser.password) {
      return { success: false, message: 'This email is registered via Google. Please use Google login.' };
    }
    if (existingUser?.isEmailVerified) {
      return { success: false, message: 'Email already registered. Please login instead.' };
    }

    // Validate referral code if provided
    if (referralCode && referralCode.trim()) {
      const referrer = await User.findOne({ referralCode: referralCode.trim().toUpperCase(), isEmailVerified: true });
      if (!referrer) {
        return { success: false, message: 'Invalid referral code' };
      }
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await User.findOneAndUpdate(
      { email },
      { name, email, phone: phoneNumber, password: hashedPassword, isEmailVerified: false },
      { upsert: true, new: true }
    );

    await sendOTP(email, "SIGNUP");

    return { success: true, email, otpPurpose: "SIGNUP" };
  } catch (error) {
    console.error("Signup error:", error);
    return { success: false, message: 'Something went wrong. Please try again.' };
  }
};

// ✅ LOGIN
export const loginService = async (email, password) => {
  try {
    if (!email || !password) {
      return { success: false, message: `${MESSAGES.AUTH.EMAIL_REQUIRED} and ${MESSAGES.AUTH.PASSWORD_REQUIRED}` };
    }

    const normalizedEmail = email.trim().toLowerCase();
    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      return { success: false, message: MESSAGES.AUTH.INVALID_CREDENTIALS };
    }

    if (!user.isEmailVerified) {
      return { success: false, message: MESSAGES.AUTH.EMAIL_NOT_VERIFIED };
    }

    if (user.isBlocked) {
      return { success: false, message: MESSAGES.AUTH.ACCOUNT_BLOCKED };
    }

    if (user.role === "admin") {
      return { success: false, message: MESSAGES.AUTH.ADMIN_LOGIN_FORBIDDEN };
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return { success: false, message: MESSAGES.AUTH.INVALID_CREDENTIALS };
    }

    return {
      success: true,
      user: {
        id: user._id,
        name: user.name,
        phone: user.phone,
        email: user.email,
        role: user.role,
        profilePhoto: user.profilePhoto
      }
    };
  } catch (error) {
    console.error("Login error:", error);
    return { success: false, message: MESSAGES.GENERIC.SOMETHING_WENT_WRONG };
  }
};

// ✅ FORGOT PASSWORD
export const forgotPasswordService = async (email) => {
  try {
    if (!email) return { success: false, message: 'Please enter your email address' };

    email = email.trim().toLowerCase();

    const user = await User.findOne({ email });

    if (!user || !user.isEmailVerified) {
      return { success: false, message: 'No account found with this email address' };
    }

    // Allow blocked users to reset password — don't block them here

    await sendOTP(email, "FORGOT_PASSWORD");

    return { success: true, email, otpPurpose: "FORGOT_PASSWORD" };
  } catch (error) {
    console.error("Forgot error:", error);
    return { success: false, message: 'Something went wrong. Please try again.' };
  }
};

// ✅ RESET PASSWORD
export const resetPasswordService = async (email, password, confirmPassword) => {
  try {
    if (!password || !confirmPassword) {
      return { success: false, message: MESSAGES.GENERIC.ALL_FIELDS_REQUIRED };
    }

    if (password !== confirmPassword) {
      return { success: false, message: MESSAGES.AUTH.PASSWORD_MISMATCH };
    }

    if (password.length < 8) {
      return { success: false, message: MESSAGES.AUTH.PASSWORD_MIN_LENGTH_LONG };
    }

    const user = await User.findOne({ email });
    if (!user) {
      return { success: false, message: MESSAGES.AUTH.SESSION_EXPIRED };
    }

    const isSame = await bcrypt.compare(password, user.password);
    if (isSame) {
      return { success: false, message: MESSAGES.AUTH.PASSWORD_SAME_AS_OLD };
    }

    user.password = await bcrypt.hash(password, 10);
    await user.save();

    return { success: true };
  } catch (error) {
    console.error("Reset error:", error);
    return { success: false, message: MESSAGES.GENERIC.INTERNAL_ERROR };
  }
};
