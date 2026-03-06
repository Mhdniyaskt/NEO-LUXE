import User from "../../models/userModel.js";
import bcrypt from "bcrypt";
import asyncHandler from "../../utils/asyncHandler.js";
import { sendOTP } from "../../utils/sendOtpMail.js";


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
  let { name, email, phone, password } = req.body;

console.log(req.body)
  name = name?.trim();
  email = email?.trim().toLowerCase();
  phone = phone?.trim();
  password = password?.trim();
  

 
  if (!name || !email || !phone || !password ) {
    return res.json({
      success: false,
      message: "All fields are required",
    });
  }

  if (!/^[A-Za-z ]+$/.test(name)) {
    return res.json({
      success: false,
      message: "Name can only contain letters",
    });
  }

  if (name.length < 3 || name.length > 30) {
    return res.json({
      success: false,
      message: "Name must be between 3 and 30 characters",
    });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!emailRegex.test(email)) {
    return res.json({
      success: false,
      message: "Please enter a valid email address",
    });
  }

 
  const phoneRegex = /^[6-9]\d{9}$/;

  if (!phoneRegex.test(phone)) {
    return res.json({
      success: false,
      message: "Please enter a valid phone number",
    });
  }

  if (password.length < 8) {
    return res.json({
      success: false,
      message: "Password must be at least 8 characters long",
    });
  }

 
  const passwordRegex =
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&]).{8,}$/;

  if (!passwordRegex.test(password)) {
    return res.json({
      success: false,
      message:
        "Password must include uppercase, lowercase, number and special character",
    });
  }


  const existingUser = await User.findOne({ email });

  if (existingUser?.googleId && !existingUser.password) {
    return res.json({
      success: false,
      message: "Email already registered with Google login",
    });
  }

  if (existingUser?.isVerified) {
    return res.json({
      success: false,
      message: "Email already registered",
    });
  }

  const hashedPassword = await bcrypt.hash(password, 10);


  await User.findOneAndUpdate(
    { email },
    {
      name,
      email,
      phone,
      password: hashedPassword,
      isVerified: false,
    },
    { upsert: true, new: true }
  );

  req.session.email=email
  await sendOTP(email, "SIGNUP");

  
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

 
  if (!email || !password) {
    return res.json({
      success: false,
      message: "Email and Password are required",
    });
  }

  const normalizedEmail = email.trim().toLowerCase();

  
  const user = await User.findOne({ email: normalizedEmail });

  if (!user) {
    return res.json({
      success: false,
      message: "Incorrect Email or Password",
    });
  }

 
  if (!user.isEmailVerified) {
    return res.json({
      success: false,
      message: "Please verify your email first",
    });
  }

  
  if (user.isBlocked) {
    return res.json({
      success: false,
      message: "Your account is blocked",
    });
  }


  if (user.role === "admin") {
    return res.json({
      success: false,
      message: "Admins cannot login from user login",
    });
  }

 
  const isPasswordValid = await bcrypt.compare(password, user.password);

  if (!isPasswordValid) {
    return res.json({
      success: false,
      message: "Incorrect Email or Password",
    });
  }

  req.session.user = {
    id: user._id,
    email: user.email,
    role: user.role,
  };

  return res.json({
    success: true,
    redirect: "/",
  });
});

export const logout = (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("Logout Error:", err);
      return res.redirect("/");
    }

    res.clearCookie("connect.sid"); 
    return res.redirect("/");
  });
};

export const showForgotPassword = (req, res) => {
 
  delete req.session.email;
  delete req.session.otpPurpose;
  delete req.session.allowPasswordReset;

  res.render("user/forgotPass", { layout: "layouts/user" });
};

export const handleForgotPassword = asyncHandler(async (req, res) => {
  let { email } = req.body;

  email = email?.trim().toLowerCase();

  if (!email) {
    return res.json({
      success: false,
      message: "Email address is required",
    });
  }

 
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!emailRegex.test(email)) {
    return res.json({
      success: false,
      message: "Enter a valid email address",
    });
  }

  const user = await User.findOne({ email });


  if (!user || !user.isEmailVerified || user.isBlocked) {
    return res.json({
      success: false,
      message: "Invalid email address",
    });
  }

  await sendOTP(email, "FORGOT_PASSWORD");

    req.session.resetPassword = email
   
    req.session.purpose= "FORGOT_PASSWORD"
 

  return res.json({
    success: true,
    redirect: "/verify-otp",
  });
});



export const showResetPassword = (req, res) => {
  if (!req.session.allowPasswordReset || !req.session.email) {
    return res.redirect("/forgot-password");
  }
  res.render("user/resetPass", { layout: "layouts/user" });
};

export const handleResetPassword = asyncHandler(async (req, res) => {
  let { password, confirmPassword } = req.body;

  password = password?.trim();
  confirmPassword = confirmPassword?.trim();

 
  if (!req.session.allowPasswordReset || !req.session.email) {
    return res.json({
      success: false,
      redirect: "/forgot-password",
    });
  }

  if (!password || !confirmPassword) {
    return res.json({
      success: false,
      message: "Both password fields are required",
    });
  }

  if (password.length < 8) {
    return res.json({
      success: false,
      message: "Password must be at least 8 characters long",
    });
  }

  const passwordRegex =
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&]).{8,}$/;

  if (!passwordRegex.test(password)) {
    return res.json({
      success: false,
      message:
        "Password must include uppercase, lowercase, number and special character",
    });
  }

  if (password !== confirmPassword) {
    return res.json({
      success: false,
      message: "Passwords do not match",
    });
  }

  const user = await User.findOne({ email: req.session.email });

  if (!user) {
    return res.json({
      success: false,
      redirect: "/forgot-password",
    });
  }

 
  const isSamePassword = await bcrypt.compare(password, user.password);

  if (isSamePassword) {
    return res.json({
      success: false,
      message: "New password cannot be the same as old password",
    });
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  user.password = hashedPassword;
  user.passwordChangedAt = new Date();
  await user.save();

 
  delete req.session.allowPasswordReset;
  delete req.session.email;
  delete req.session.otpPurpose;
  delete req.session.userId;

  return res.json({
    success: true,
    message: "Password reset successful",
    redirect: "/login",
  });
});