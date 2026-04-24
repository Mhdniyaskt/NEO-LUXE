import Address from "../models/address.model.js";
import User from "../models/user.model.js";

export const getUserAddressesService = async (userId, page, limit) => {
  try {
    const skip = (page - 1) * limit;
    const addresses = await Address.find({ userId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const totalAddress = await Address.countDocuments({ userId });
    return {
      success: true,
      addresses,
      totalPages: Math.ceil(totalAddress / limit)
    };
  } catch (error) {
    console.error("Service error (get addresses):", error);
    return { success: false, message: "Something went wrong" };
  }
};

export const addAddressService = async (userId, data) => {
  try {
    const { fullName, phone, pincode, streetAddress, city, state, addressType } = data;

    const hasAddress = await Address.exists({ userId });

    const address = await Address.create({
      userId,
      fullName,
      phone,
      streetAddress,
      city,
      state,
      pincode,
      addressType: addressType || "Home",
      isDefault: !hasAddress
    });

    await User.findByIdAndUpdate(userId, { $push: { addresses: address._id } });
    return { success: true, message: "Address added successfully" };
  } catch (error) {
    console.error("Service error (add address):", error);
    return { success: false, message: "Something went wrong" };
  }
};

export const updateAddressService = async (userId, addressId, data) => {
  try {
    // Prevent sensitive or metadata fields from being updated via req.body
    const { _method, _id, userId: _, ...updateData } = data;

    const updated = await Address.findOneAndUpdate(
      { _id: addressId, userId },
      { $set: updateData },
      { new: true, runValidators: true }
    );

    if (!updated) {
      return { success: false, message: "Address update failed" };
    }

    return { success: true, message: "Address updated successfully" };
  } catch (error) {
    console.error("Service error (update address):", error);
    return { success: false, message: "Something went wrong" };
  }
};

export const deleteAddressService = async (userId, addressId) => {
  try {
    const deletedAddress = await Address.findOneAndDelete({ _id: addressId, userId });

    if (!deletedAddress) {
      return { success: false, message: "Could not delete address" };
    }

    await User.findByIdAndUpdate(userId, { $pull: { addresses: addressId } });
    return { success: true, message: "Address deleted successfully" };
  } catch (error) {
    console.error("Service error (delete address):", error);
    return { success: false, message: "Something went wrong" };
  }
};