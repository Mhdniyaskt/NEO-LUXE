import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: true,
      trim: true
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true
    },

    password: {
      type: String,
      required: true
    },

    role: {
      type: String,
      enum: ["user", "admin"],
      default: "user"
    },

    profileImage: {
      type: String,
      default: ""
    },

    mobileNumber: {
      type: Number
    },

    isBlocked: {
      type: Boolean,
      default: false
    },

    referredBy: {
      type: String
    },

    referralCode: {
      type: String
    },

    isEmailVerified: {
      type: Boolean,
      default: false
    }
  },
  {
    timestamps: true 
  }
);

export default mongoose.model("User", userSchema);
