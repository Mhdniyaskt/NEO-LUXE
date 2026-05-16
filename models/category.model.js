import mongoose from "mongoose";

const categorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    description: { type: String, default: "" },
    // Category-level offer (applies to all products in this category)
    offerPercentage: { type: Number, default: 0, min: 0, max: 90 },
    offerExpiryDate: { type: Date, default: null },
    isDeleted: { type: Boolean, default: false },
    isListed: { type: Boolean, default: true }
  },
  { timestamps: true }
);

export default mongoose.model("Category", categorySchema);