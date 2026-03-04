import mongoose from "mongoose";

const otpSchema = new mongoose.Schema({
    email:{
        type:String,
        required:true,
        index:true
    },
    otp:{
        type:String,
        required:true 
    },

    purpose:{
        type:String,
        enum:["SIGNUP","FORGOT_PASSWORD","EMAIL_CHANGE"],
        required:true
    },

    createdAt:{
        type:Date,
        default:Date.now,
        expires:300
    },
    attempts:{
        type:Number,
        default:0,
        max:5
    },
})


export default mongoose.model("OTP",otpSchema);


