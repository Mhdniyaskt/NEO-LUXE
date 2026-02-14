import User from "../../models/userModel.js";
import bcrypt from "bcrypt";
import {generateOtp} from "../../utils/otp.js";
import Otp from "../../models/EmailOtp.js";
import { sendOtpMail } from "../../utils/sendOtpMail.js";
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

export const signupSubmit = async (req, res) => {
  try {
    const { fullName, email, password, mobileNumber } = req.body;
console.log(fullName)
    if (
      !fullName?.trim() ||
      !email?.trim() ||
      !password?.trim() ||
      !mobileNumber?.trim()
    ) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }

    if (!fullName || !/^[A-Za-z ]+$/.test(fullName)) {
      return res.status(400).json({
        success: false,
        message: "Name can only contain letters",
      });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid email address",
      });
    }

    const phoneRegex = /^[6-9]\d{9}$/;
    if (!phoneRegex.test(mobileNumber)) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid Phone Number",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password needs minimum 6 characters",
      });
    }

    const existingUser = await User.findOne({ email });

    if (existingUser && existingUser.isVerified) {
      return {
        success: false,
        errors: { email: "User already exists" },
      };
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await User.findOneAndUpdate(
      { email },
      {
        fullName,
        mobileNumber,
        password: hashedPassword,
        isVerified: false,
      },
      { upsert: true, new: true },
    );

    const otp = generateOtp();

     await Otp.deleteMany({ email });
     
    await Otp.create({ email, otp });

    await sendOtpMail(email, otp);

    req.session.signupEmail = email;
    console.log("singup",req.session.signupEmail )
    return res.status(201).json({
      success: true,
      message: "Signup successful",
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      message: error.message || "Something went wrong. Please try again.",
    });
  }
};

export const loadLogin = async (req, res) => {
  try {
    res.render("user/login", { layout: "layouts/user" });
  } catch (error) {
    res.status(500).send("server Error");
  }
};

export const postLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const user = await User.findOne({ email });

    // if (!user) {
    //   return res.status(400).json({ message: "Invalid email or password" });
    // }

    // 3. check verified
    // if (!user.isVerified) {
    //   return res.status(403).json({ message: "Please verify your email" });
    // }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(400).json({ message: "Invalid email or password" });
    }

    req.session.user = {
      id: user._id,
      email: user.email,
      name: user.name,
    };

    res.json({
      success: true,
      redirectUrl: "/",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Login failed" });
  }
};


export const getProfile = async (req, res) => {
  try {

    res.render("user/myProfile", { layout: "layouts/user" });
  } catch (error) {
    res.status(500).send("server Error");
  }

};

export const getEditProfile = async (req, res) => {
  try {
   

    res.render("user/editProfile", { layout: "layouts/user" });

  } catch (error) {
    console.error(error);
    res.redirect("/profile");
  }
};


export const getChangeEmail = async (req, res) => {
  try {
   

    res.render("user/changeEmail", { layout: "layouts/user" });

  } catch (error) {
    console.error(error);
    res.redirect("/profile");
  }
};


export const getChangePassword = async (req, res) => {
  try {
   

    res.render("user/changePass", { layout: "layouts/user" });

  } catch (error) {
    console.error(error);
    res.redirect("/profile");
  }
};


export const getResetPassword = async (req, res) => {
  try {
   

    res.render("user/resetPass", { layout: "layouts/user" });

  } catch (error) {
    console.error(error);
    res.redirect("/profile");
  }
};



