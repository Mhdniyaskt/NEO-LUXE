import OTP from "../../models/otp.model.js";
import User from "../../models/user.model.js";
import crypto from "crypto";
import { sendOTP } from "../../utils/sendOtp.util.js";
import { HTTP_STATUS } from "../../constants/http-status.constant.js";
import asyncHandler from "../../utils/asyncHandler.util.js";


export const showVerifyOTP = (req,res)=>{

     return res.render("user/otp-verify-page",{layout: "layouts/user",
        actionUrl: "/verify-otp",
        resendUrl: "/resend-otp",
    });
}

export const verifyOTP = asyncHandler(async (req, res) => {

    const email = req.session.email;
    const purpose = req.session.otpPurpose;

    if (!email || !purpose) {
        return res.status(400).json({
            success: false,
            message: "Session expired. Please signup again."
        });
    }

    const { otp } = req.body;

    const otpRecord = await OTP.findOne({ email, purpose }).sort({ createdAt: -1 });

    if (!otpRecord) {
        return res.json({
            success: false,
            message: "OTP invalid or expired"
        });
    }

    if (otpRecord.attempts >= 5) {
        await OTP.deleteOne({ _id: otpRecord._id });

        return res.json({
            success: false,
            message: "Too many attempts. Request new OTP."
        });
    }

    const hashedOtp = crypto.createHash("sha256").update(otp).digest("hex");

    if (otpRecord.otp !== hashedOtp) {
        otpRecord.attempts += 1;
        await otpRecord.save();

        return res.json({
            success: false,
            message: `OTP incorrect. ${5 - otpRecord.attempts} attempts remaining`
        });
    }

    // SIGNUP
    if (purpose === "SIGNUP") {
        await User.findOneAndUpdate(
            { email },
            {  isEmailVerified: true },
            { new: true }
        );

        await OTP.deleteMany({ email, purpose });

        return res.json({
            success: true,
            redirect: "/login",
            message: "Email verified successfully"
        });
    }

    // FORGOT PASSWORD
    if (purpose === "FORGOT_PASSWORD") {
        req.session.allowPasswordReset = true;

        return res.json({
            success: true,
            redirect: "/reset-password"
        });
    }
});

export const resendOTP = async (req, res) => {
    try {
        const email = req.session?.email;
        const purpose = req.session?.otpPurpose;

        // 1. Validation
        if (!email || !purpose) {
            return res.status(400).json({
                success: false, 
                message: "Session expired. Please restart the process." 
            });
        }

        // 2. Execute Send
        await sendOTP(email, purpose);

        // 3. Dynamic Success Messages
        let displayMessage = "New OTP Sent to your email.";
        if (purpose === "FORGOT_PASSWORD") {
            displayMessage = "If an account exists, a new OTP has been sent.";
        }

        return res.status(200).json({
            success: true,
            message: displayMessage
        });

    } catch (error) {
        console.error("Resend OTP Error:", error);

        // 4. Return the ACTUAL error message (e.g., "Please wait before requesting another OTP")
        // instead of a generic "Failed to resend"
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Failed to resend OTP. Please try again."
        });
    }
};