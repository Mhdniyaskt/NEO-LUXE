import User from "../../models/userModel.js";
import bcrypt from "bcrypt";
import asyncHandler from "../../utils/asyncHandler.js"
import { sendOTP } from "../../utils/sendOtpMail.js";
import { generateAccessToken, generateRefreshToken } from "../../utils/userTokens.utils.js";



export const loadHome = async (req, res) => {
  try {
    res.render("user/home", { layout: "layouts/user" });
  } catch (error) {
    res.status(500).send("Server Error");
  }
};
export const loadSignup = async (req, res) => {
  try {
    res.render("user/signup", { layout: "layouts/user" });
  } catch (error) {
    res.status(500).send("server Error");
  }
};


export const handleSignup = asyncHandler(async (req, res) => {
  const { name, email, phoneNumber, password } = req.body;
 console.log(req.body)
  if (!name || !/^[A-Za-z ]+$/.test(name)) {
    return res.json({ success: false, message: "Name can only contain letters" });
  }

  if (name.length > 30 || name.length < 3) {
    return res.json({ success: false, message: "Name should be between 3-30 characters" });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.json({ success: false, message: "Please enter a valid email address" });
  }

  const phoneRegex = /^[6-9]\d{9}$/;
  if (!phoneRegex.test(phone)) {
    return res.json({ success: false, message: "Please enter a valid Phone Number" });
  }

  if (password.length < 6) {
    return res.json({ success: false, message: "Password need minimum 6 characters" });
  }

  const existingUser = await User.findOne({ email });

  if (existingUser && existingUser.googleId && !existingUser.password) {
    return res.json({
      success: false,
      message: "Email Already registered with Google login",
    });
  }

  if (existingUser && existingUser.isVerified) {
    return res.json({ success: false, message: "Email Already Registered" });
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  await User.findOneAndUpdate(
    { email },
    {
      name,
      phoneNumber,
      password: hashedPassword,
      isVerified: false,
    },
    { upsert: true, new: true }
  );

  try {
    await sendOTP(email, "SIGNUP");
  } catch (error) {
    return res.json({ success: false, message: error.message });
  }

  req.session.email = email;
  req.session.otpPurpose = "SIGNUP";

  return res.json({
    success: true,
    redirect: "/verify-otp",
  });
});



export const loadLogin = async (req, res) => {
  try {
    res.render("user/login", { layout: "layouts/user" });
  } catch (error) {
    res.status(500).send("server Error");
  }
};

export const handleLogin = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email });

  if (!user || !user.isEmailVerified) {
    return res.json({
      success: false,
      message: "Incorrect Email or Password"
    });
  }

  if (user.isBlocked) {
    return res.json({
      success: false,
      message: "Your account is blocked"
    });
  }

  if (user.role === "admin") {
    return res.json({
      success: false,
      message: "Admins cannot login from user login"
    });
  }

  const isMatch = await bcrypt.compare(password, user.password);

  if (!isMatch) {
    return res.json({
      success: false,
      message: "Incorrect Email or Password"
    });
  }

  // ✅ Store user in session
  req.session.user = {
    id: user._id,
    email: user.email,
    role: user.role
  };

  return res.json({
    success: true,
    redirect: "/"
  });
});


export const logout = (req, res) => {
  try {
    res.clearCookie("accessToken");
    res.clearCookie("refreshToken");

    return res.redirect("/");
  } catch (error) {
    console.error("Logout Error:", error);
    return res.redirect("/");
  }
};





export const showForgotPassword = (req, res) => {

  // Clear any previous OTP session data
  delete req.session.email;
  delete req.session.otpPurpose;
  delete req.session.allowPasswordReset;

  // Render forgot password page
  res.render("user/forgotPass",{layout:"layouts/user"});

};

export const handleForgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.json({
      success: false,
      message: "Enter email address",
    });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!emailRegex.test(email)) {
    return res.json({
      success: false,
      message: "Enter valid email address",
    });
  }

  const user = await User.findOne({ email });

  if (user && user.isEmailVerified && !user.isBlocked) {
    try {
      await sendOTP(email, "FORGOT_PASSWORD");

      req.session.email = email;
      req.session.otpPurpose = "FORGOT_PASSWORD";

      return res.json({
        success: true,
        redirect: "/verify-otp",
      });

    } catch (error) {
      return res.json({
        success: false,
        message: "Failed to send OTP. Try again",
      });
    }
  }

  return res.json({
    success: false,
    message: "Invalid email",
  });
});

export const showResetPassword = (req, res) => {
  if (!req.session.allowPasswordReset || !req.session.email) {
    return res.redirect("/forgot-password");
  }
  res.render("user/resetPass",{layout:"layouts/user"});
};
export const handleResetPassword = asyncHandler(async (req, res) => {

  const { password, confirmPassword } = req.body;

  if (!req.session.allowPasswordReset || !req.session.email) {
    return res.json({
      success: false,
      redirect: "/forgot-password"
    });
  }

  if (!password || password.length < 6) {
    return res.json({
      success: false,
      message: "Password must be at least 6 characters"
    });
  }

  if (password !== confirmPassword) {
    return res.json({
      success: false,
      message: "Passwords do not match"
    });
  }

  const user = await User.findOne({ email: req.session.email });

  if (!user) {
    return res.json({
      success: false,
      redirect: "/forgot-password"
    });
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  user.password = hashedPassword;
  user.passwordChangedAt = new Date();
  await user.save();



  // cleanup session
  delete req.session.allowPasswordReset;
  delete req.session.email;
  delete req.session.otpPurpose;
delete req.session.userId
  return res.json({
    success: true,
    redirect: "/login",
    message: "Password reset successful"
  });

});