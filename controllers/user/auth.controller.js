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
// This runs when they enter email on /forgot-password
export const handleForgotPassword = asyncHandler(async (req, res) => {
    const email = req.body.email;

    // Call service to generate OTP and send email
    const result = await forgotPasswordService(email);

    if (result.success) {
        // Store info in session for the next step
        req.session.email = result.email;
        req.session.otpPurpose = "FORGOT_PASSWORD";
        
        return res.json({ 
            success: true, 
            redirect: "/verify-otp" // Now they go to enter the code
        });
    }

    return res.json(result);
});
// RESET PAGE
export const showResetPassword = (req, res) => {
  if (!req.session.allowPasswordReset || !req.session.email) {
    return res.redirect("/forgot-password");
  }
  res.render("user/reset-password", { layout: "layouts/user" });
};

// RESET HANDLE
// This runs when they submit the NEW PASSWORD form
export const handleResetPassword = asyncHandler(async (req, res) => {
    const { password, confirmPassword } = req.body;
    const email = req.session.email; // Get email from session, not body

    // SECURITY CHECK
    if (!req.session.allowPasswordReset || !email) {
        return res.status(403).json({ 
            success: false, 
            message: "Unauthorized. Please verify your OTP first.",
            redirect: "/forgot-password" 
        });
    }

    // Call the RESET service to change the password in DB
    const result = await resetPasswordService(email, password, confirmPassword);

    if (result.success) {
        // CLEANUP
        req.session.allowPasswordReset = false;
        delete req.session.email;
        delete req.session.otpPurpose;

        return res.json({ 
            success: true, 
            message: "Password updated!", 
            redirect: "/login" 
        });
    }

    return res.json(result);
});