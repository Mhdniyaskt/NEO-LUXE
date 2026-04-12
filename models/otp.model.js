import mongoose from "mongoose";

const otpSchema = new mongoose.Schema({
    email: {
        type: String,
        required: true,
        lowercase: true, // Good practice for consistency
        trim: true,
        index: true
    },
    otp: {
        type: String,
        required: true 
    },
    purpose: {
        type: String,
        enum: ["SIGNUP", "FORGOT_PASSWORD", "EMAIL_CHANGE"],
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now,
        expires: 300 // 5 minutes
    },
    attempts: {
        type: Number,
        default: 0
        // Don't rely on 'max' here; handle it in your controller logic
    },
    lastAttemptAt: { // Track timing to prevent rapid brute-forcing
        type: Date,
        default: Date.now
    }
}, { timestamps: true }); // Adds updatedAt automatically

export default mongoose.model("OTP", otpSchema);