import mongoose from "mongoose";

const addressSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    fullName: {
      type: String,
      required: true,
      trim: true
    },
    phone: {
      type: String,
      required: true,
      trim: true,
      match: [/^[0-9]{10}$/, "Please provide a valid 10-digit phone number"]
    },
    streetAddress: {
      type: String,
      required: true,
      trim: true
    },
    city: {
      type: String,
      required: true,
      trim: true
    },
    state: {
      type: String,
      required: true,
      trim: true
    },
    pincode: {
      type: String,
      required: true,
      trim: true,
      match: [/^[0-9]{6}$/, "Please provide a valid 6-digit pincode"]
    },
    addressType: {
      type: String,
      enum: ["Home", "Office"],
      default: "Home", // Now the DB knows how to store Home/Office
      required: true
    },
    country: {
      type: String,
      default: "India"
    },
    isDefault: {
      type: Boolean,
      default: false
    }
  },
  {
    timestamps: true
  }
);

export default mongoose.model("Address", addressSchema);