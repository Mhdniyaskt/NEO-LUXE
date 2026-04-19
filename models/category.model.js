import mongoose from "mongoose";

const categorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    description: { type: String, default: "" },
    isDeleted: { type: Boolean, default: false },
    isListed: { type: Boolean, default: true },
    offerPercent: { type: Number, min: 0, max: 90, default: 0 },
    offerExpiry: { type: Date, default: null },
  },
  { timestamps: true }
);

export default mongoose.model("Category", categorySchema);