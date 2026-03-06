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
    
    pendingEmail:{
        type:String,
        trim:true
    },

    profilePhoto: {
      url: String,
      public_id:String
    },

    phone: {
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
    },addresses: [
        {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Address"
        }
    ],

    referredBy: {
      type: String
    },

    referralCode: {
      type: String
    },

    isEmailVerified: {
      type: Boolean,
      default: false
    },passwordChangedAt:{
        type:Date
    }
  },
  {
    timestamps: true 
  }
);

export default mongoose.model("User", userSchema);
