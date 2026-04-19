import asyncHandler from "../../utils/asyncHandler.util.js";
import {
  homeService,
  signupService,
  loginService,
  forgotPasswordService,
  resetPasswordService
} from "../../services/auth.service.js";

// HOME
export const loadHome = async (req, res) => {
  const result = await homeService(res.locals.user);
  res.render("user/home-page", { layout: "layouts/user", user: result.user });
};

// SIGNUP PAGE
export const loadSignup = (req, res) => {
  res.render("user/signup-page", { layout: "layouts/user" });
};

// SIGNUP
export const handleSignup = asyncHandler(async (req, res) => {
  const result = await signupService(req.body);

  if (!result.success) return res.json(result);

  req.session.email = result.email;
  req.session.otpPurpose = result.otpPurpose;

  return res.json({ success: true, redirect: "/verify-otp" });
});

// LOGIN PAGE
export const loadLogin = (req, res) => {
  const { error } = req.query;
  let message = null;

  if (error === "blocked") message = "Your account is blocked.";
  if (error === "admin_denied") message = "Admin cannot login here.";

  res.render("user/login-page", { layout: "layouts/user", message });
};

// LOGIN
export const handleLogin = asyncHandler(async (req, res) => {
  const result = await loginService(req.body.email, req.body.password);

  if (!result.success) return res.json(result);

  req.session.user = result.user;

  return res.json({ success: true, redirect: "/" });
});

// LOGOUT
export const logout = (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.redirect("/login");
  });
};

// FORGOT PAGE
export const showForgotPassword = (req, res) => {
  delete req.session.email;
  delete req.session.otpPurpose;
  delete req.session.allowPasswordReset;

  res.render("user/forgot-password", { layout: "layouts/user" });
};

// FORGOT HANDLE
export const handleForgotPassword = asyncHandler(async (req, res) => {
  const email = req.body.email || req.session.user?.email;

  const result = await forgotPasswordService(email);

  if (!result.success) return res.json(result);

  req.session.email = result.email;
  req.session.otpPurpose = result.otpPurpose;

  return res.json({ success: true, redirect: "/verify-otp" });
});

// RESET PAGE
export const showResetPassword = (req, res) => {
  if (!req.session.allowPasswordReset || !req.session.email) {
    return res.redirect("/forgot-password");
  }
  res.render("user/reset-password", { layout: "layouts/user" });
};

// RESET HANDLE
export const handleResetPassword = asyncHandler(async (req, res) => {
  const email = req.session.email;

  const result = await resetPasswordService(
    email,
    req.body.password,
    req.body.confirmPassword
  );

  if (!result.success) return res.json(result);

  const isLoggedIn = !!req.session.user;

  delete req.session.allowPasswordReset;
  delete req.session.email;
  delete req.session.otpPurpose;

  return res.json({
    success: true,
    redirect: isLoggedIn ? "/profile" : "/login"
  });
});