import User from "../models/user.model.js";
import bcrypt from "bcrypt";
import { sendOTP } from "../utils/sendOtp.util.js";

// ✅ HOME (no logic, just pass user)
export const homeService = async (user) => {
  return { success: true, user };
};

// ✅ SIGNUP
export const signupService = async (data) => {
  try {
    let { name, email, phoneNumber, password } = data;

    name = name?.trim();
    email = email?.trim().toLowerCase();
    phoneNumber = phoneNumber?.trim();
    password = password?.trim();

    // VALIDATIONS
    if (!name || !email || !phoneNumber || !password) {
      return { success: false, message: "All fields are required" };
    }

    if (!/^[A-Za-z ]+$/.test(name)) {
      return { success: false, message: "Name can only contain letters" };
    }

    if (name.length < 3 || name.length > 30) {
      return { success: false, message: "Name must be between 3 and 30 characters" };
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return { success: false, message: "Please enter a valid email" };
    }

    const phoneRegex = /^[6-9]\d{9}$/;
    if (!phoneRegex.test(phoneNumber)) {
      return { success: false, message: "Please enter a valid phone number" };
    }

    if (password.length < 8) {
      return { success: false, message: "Password must be at least 8 characters" };
    }

    const passwordRegex =
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/;

    if (!passwordRegex.test(password)) {
      return {
        success: false,
        message: "Password must include uppercase, lowercase, number and special character"
      };
    }

    const existingUser = await User.findOne({ email });

    if (existingUser?.googleId && !existingUser.password) {
      return { success: false, message: "Email already registered with Google login" };
    }

    if (existingUser?.isVerified) {
      return { success: false, message: "Email already registered" };
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await User.findOneAndUpdate(
      { email },
      {
        name,
        email,
        phone: phoneNumber,
        password: hashedPassword,
        isVerified: false
      },
      { upsert: true, new: true }
    );

    await sendOTP(email, "SIGNUP");

    return {
      success: true,
      email,
      otpPurpose: "SIGNUP"
    };

  } catch (error) {
    console.error("Signup error:", error);
    return { success: false, message: "Something went wrong" };
  }
};

// ✅ LOGIN
export const loginService = async (email, password) => {
  try {
    if (!email || !password) {
      return { success: false, message: "Email and Password are required" };
    }

    const normalizedEmail = email.trim().toLowerCase();
    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      return { success: false, message: "Incorrect Email or Password" };
    }

    if (!user.isEmailVerified) {
      return { success: false, message: "Please verify your email first" };
    }

    if (user.isBlocked) {
      return { success: false, message: "Your account is blocked" };
    }

    if (user.role === "admin") {
      return { success: false, message: "Admins cannot login here" };
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      return { success: false, message: "Incorrect Email or Password" };
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
    return { success: false, message: "Something went wrong" };
  }
};

// ✅ FORGOT PASSWORD
export const forgotPasswordService = async (email) => {
  try {
    if (!email) return { success: false, message: "Email is required" };

    const user = await User.findOne({ email });

    if (!user || !user.isEmailVerified || user.isBlocked) {
      return { success: false, message: "Invalid email address" };
    }

    await sendOTP(email, "FORGOT_PASSWORD");

    return {
      success: true,
      email,
      otpPurpose: "FORGOT_PASSWORD"
    };

  } catch (error) {
    console.error("Forgot error:", error);
    return { success: false, message: "Something went wrong" };
  }
};

// ✅ RESET PASSWORD
export const resetPasswordService = async (email, password, confirmPassword) => {
    try {
        // 1. Basic presence check
        if (!password || !confirmPassword) {
            return { success: false, message: "All fields are required" };
        }

        // 2. Matching check
        if (password !== confirmPassword) {
            return { success: false, message: "Passwords do not match" };
        }

        // 3. Complexity/Length check
        if (password.length < 8) {
            return { success: false, message: "Password must be at least 8 characters long" };
        }

        // 4. User existence check
        const user = await User.findOne({ email });
        if (!user) {
            return { success: false, message: "User session expired. Please restart the process." };
        }

        // 5. Old password check
        const isSame = await bcrypt.compare(password, user.password);
        if (isSame) {
            return { success: false, message: "New password cannot be the same as your old password" };
        }

        // 6. Save new password
        user.password = await bcrypt.hash(password, 10);
        await user.save();

        return { success: true };

    } catch (error) {
        console.error("Reset error:", error);
        return { success: false, message: "An internal error occurred" };
    }
};