import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    name: {
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
     default:"null"
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

    phoneNumber: {
      type: Number
    },

    isBlocked: {
      type: Boolean,
      default: false
    },
      googleId:{
        type:String,
        unique:true,
        sparse:true
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
