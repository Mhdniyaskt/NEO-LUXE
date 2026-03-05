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





 
// export const showChangePasswordPage = async (req, res) => {
//   try {

//     res.render("user/changePass", {
//       layout: "layouts/user"
//     });

//   } catch (error) {

//     console.error("Change password page error:", error);
//     res.redirect("/profile");

//   }
// };

// export const handleForgotPassword = asyncHandler(async (req, res) => {
//   const { email } = req.body;

//   if (!email) {
//     req.flash("error", "Enter email Address");
//     return res.redirect("/forgot-password");
//   }

//   const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

//   if (!emailRegex.test(email)) {
//     req.flash("error", "Enter valid email Address");
//     return res.redirect("/forgot-password");
//   }

//   const user = await User.findOne({ email });

//   if (user && user.isVerified && !user.isBlocked && user.password) {


//   try {

//   await sendOTP(email, "FORGOT_PASSWORD");

// } catch (error) {

//   return res.render("user/forgot-password", { error: error.message });
// }




//     req.session.email = email;
//     req.session.otpPurpose = "FORGOT_PASSWORD";
//     req.flash(
//       "success",
//       "If an account exists with this email,You will receive an OTP shortly"
//     );
//     return res.redirect("/verify-otp");
//   }

//   req.flash("error", "Invalid Email");
//   return res.redirect("/forgot-password");
// });
// export const getResetPassword = async (req, res) => {
//   try {
  // if (!req.session.allowPasswordReset || !req.session.email) {
  //   return res.redirect("/forgot-password");
  // }
//     res.render("user/resetPass", { layout: "layouts/user" });
//   } catch (error) {
//     console.error(error);
//     res.redirect("/profile");
//   }
// };


// export const handleResetPassword = asyncHandler(async (req, res) => {
//   const { password, confirmPassword } = req.body;

//   if (!req.session.allowPasswordReset || !req.session.email) {
//     return res.redirect("/forgot-password");
//   }

//   if (password.length < 6) {
//     req.flash("error", "Password must be atleast 6 characters");
//     return res.redirect("/reset-password");
//   }

//   if (password !== confirmPassword) {
//     req.flash("error", "Passwords do not match");
//     return res.redirect("/reset-password");
//   }

//   const user = await User.findOne({ email: req.session.email });
//   if (!user) {
//     return res.redirect("/forgot-password");
//   }

//   const hashedPassword = await bcrypt.hash(password, 10);

//   user.password = hashedPassword;
//   user.passwordChangedAt = new Date();
//   await user.save();

//   //invalidate

//   res.clearCookie("accessToken");
//   res.clearCookie("refreshToken");

//   // Cleanup
//   delete req.session.allowPasswordReset;
//   delete req.session.email;
//   delete req.session.otpPurpose;

//   req.flash("success", "Password reset Successful.Please Login.");
//   return res.redirect("/login");
// });
