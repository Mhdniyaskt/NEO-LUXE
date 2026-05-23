import asyncHandler from "../../utils/asyncHandler.util.js";
import {
  homeService,
  signupService,
  loginService,
  forgotPasswordService,
  resetPasswordService
} from "../../services/auth.service.js";
import Product from "../../models/product.model.js";
import Variant from "../../models/variant.model.js";
import Category from "../../models/category.model.js";

// HOME
export const loadHome = async (req, res) => {
  const result = await homeService(res.locals.user);

  // ── Featured / hero product (newest active product with a variant image) ──
  const heroProduct = await Product.findOne({ isActive: true, isDeleted: false })
    .sort({ createdAt: -1 })
    .lean();

  let heroImage = null;
  if (heroProduct) {
    const heroVariant = await Variant.findOne({
      product: heroProduct._id, isActive: true, isDeleted: false,
    }).lean();
    heroImage = heroVariant?.images?.[0]?.url || null;
  }

  // ── Listed categories (up to 6) with one product image each ──────────────
  const categories = await Category.find({ isListed: true, isDeleted: false })
    .sort({ createdAt: -1 })
    .limit(6)
    .lean();

  for (const cat of categories) {
    const prod = await Product.findOne({
      category: cat._id, isActive: true, isDeleted: false,
    }).lean();
    if (prod) {
      const v = await Variant.findOne({ product: prod._id, isActive: true, isDeleted: false }).lean();
      cat.image = v?.images?.[0]?.url || null;
    } else {
      cat.image = null;
    }
  }

  // ── Best sellers (8 newest active products) ───────────────────────────────
  const rawProducts = await Product.find({ isActive: true, isDeleted: false })
    .populate({ path: 'category', match: { isListed: true, isDeleted: false }, select: 'name' })
    .sort({ createdAt: -1 })
    .limit(16)
    .lean();

  const bestSellers = [];
  for (const p of rawProducts) {
    if (!p.category) continue;
    const v = await Variant.findOne({ product: p._id, isActive: true, isDeleted: false })
      .sort({ basePrice: 1 })
      .lean();
    if (!v) continue;
    bestSellers.push({
      ...p,
      variant: {
        ...v,
        image:       v.images?.[0]?.url || null,
        salePrice:   v.basePrice,
        regPrice:    v.regularPrice,
        discPct:     0,
      },
    });
    if (bestSellers.length === 8) break;
  }

  res.render("user/home-page", {
    layout: "layouts/user",
    user: result.user,
    heroProduct,
    heroImage,
    categories,
    bestSellers,
  });
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

  // Store referral code in session for processing after OTP verification
  if (req.body.referralCode && req.body.referralCode.trim()) {
    req.session.pendingReferralCode = req.body.referralCode.trim().toUpperCase();
  }

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
  // Destroy only the user session; the admin session (different cookie) is unaffected
  req.session.destroy(() => {
    res.clearCookie("neo_luxe_user");
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