import Otp from "../../models/EmailOtp.js"
import User from "../../models/userModel.js";

export const getVerifyEmail=(req,res)=>{
  try {
    res.render("user/verifyEmail",{ layout: "layouts/user" })
  } catch (error) {
    console.log(error)
  }
}


export const verifyEmail = async (req, res) => {
  try {
    const { otp } = req.body;
    console.log(otp)
    const email = req.session.signupEmail;
console.log(email)
    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Session expired. Signup again.",
      });
    }

    const otpRecord = await Otp.findOne({ email, otp });

    if (!otpRecord) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired OTP",
      });
    }

    await User.findOneAndUpdate(
      { email },
      { isVerified: true }
    );

    await Otp.deleteMany({ email });

    req.session.signupEmail = null;

    return res.status(200).json({
      success: true,
      message: "Email verified successfully",
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Verification failed",
    });
  }
};

export const resendOtp = async (req, res) => {
  try {
    const email = req.session.signupEmail;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Session expired",
      });
    }

    const existingOtp = await Otp.findOne({ email });

    if (existingOtp) {
      return res.status(400).json({
        success: false,
        message: "Wait 5 minutes before resending",
      });
    }

    const otp = generateOtp();

    await Otp.create({ email, otp });

    await sendOtpMail(email, otp);

    return res.status(200).json({
      success: true,
      message: "OTP resent successfully",
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Resend failed",
    });
  }
};

