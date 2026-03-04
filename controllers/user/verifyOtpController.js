import OTP from "../../models/EmailOtp.js";
import User from "../../models/userModel.js";
import crypto from "crypto";
import { sendOTP } from "../../utils/sendOtpMail.js";
import { HTTP_STATUS } from "../../constants/httStatus.js";
import asyncHandler from "../../utils/asyncHandler.js";


export const showVerifyOTP = (req,res)=>{

     return res.render("user/verifyEmail",{layout: "layouts/user",
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

export const resendOTP = async (req,res)=>{
    try{

        const email = req.session?req.session.email:null;
        const purpose = req.session.otpPurpose;

        console.log(email,purpose);
        

        if(!email || !purpose){
            return res.status(400).json({message:"Session expired.Please signup again."});
        }

        await sendOTP(email,purpose);

        let message;
       
        if(purpose === "SIGNUP"){
            message = "New OTP Sent to your email. Verify to Continue.";
        }else if(purpose === "FORGOT_PASSWORD"){
            message = "If an account exists with this email,You will receive an OTP shortly";
        }else{
            message = "If an account exists with this email,You will receive an OTP shortly";
        }


        return res.status(200).json({message});

    }catch(error){

        return res.status(500).json({message:"Failed to resend OTP"});

    }
};