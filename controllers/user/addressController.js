import Address from "../../models/address.model.js";
import User from "../../models/userModel.js";
import asyncHandler from "../../utils/asyncHandler.js";

// Show address Page (Stays the same for initial load)
export const showAddressManagement = asyncHandler(async (req, res) => {
    const userId = req.session.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = 4;
    const skip = (page - 1) * limit;

    const addresses = await Address.find({ userId }).sort({ createdAt: -1 }).skip(skip).limit(limit);
    const totalAddress = await Address.countDocuments({ userId });
    const totalPages = Math.ceil(totalAddress / limit);

    res.render("user/address", { layout: "layouts/user", addresses, currentPage: page, totalPages });
});

// Add Address (AJAX Version)
export const addAddress = asyncHandler(async (req, res) => {
    const { fullName, phone, pincode, streetAddress, city, state, addressType } = req.body;
    const userId = req.session.user.id;

    if (!fullName || !phone || !streetAddress || !city || !state || !pincode) {
        return res.status(400).json({ success: false, message: "All required fields must be filled" });
    }

    const hasAddress = await Address.exists({ userId });
    const address = await Address.create({
        userId, fullName, phone, streetAddress, city, state, pincode,
        addressType: addressType || "Home",
        isDefault: !hasAddress
    });

    await User.findByIdAndUpdate(userId, { $push: { addresses: address._id } });
    res.status(200).json({ success: true, message: "Address added successfully" });
});

// Update Address (AJAX Version)
export const updateAddress = asyncHandler(async (req, res) => {
    const userId = req.session.user.id;
    const { addressId } = req.params;
    const { fullName, phone, pincode, streetAddress, city, state, addressType } = req.body;

    const updated = await Address.findOneAndUpdate(
        { _id: addressId, userId: userId },
        { fullName, phone, pincode, streetAddress, city, state, addressType },
        { new: true }
    );

    if (!updated) {
        return res.status(404).json({ success: false, message: "Address update failed" });
    }
    res.status(200).json({ success: true, message: "Address updated successfully" });
});

export const deleteAddress = asyncHandler(async (req, res) => {
    const { addressId } = req.params;
    const userId = req.session.user.id;

    const deletedAddress = await Address.findOneAndDelete({ _id: addressId, userId });

    if (!deletedAddress) {
        return res.status(404).json({ success: false, message: "Could not delete address" });
    }

    await User.findByIdAndUpdate(userId, { $pull: { addresses: addressId } });
    res.status(200).json({ success: true, message: "Address deleted successfully" });
});