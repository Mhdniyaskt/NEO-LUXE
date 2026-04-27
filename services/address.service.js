import Address from "../models/address.model.js";
import User from "../models/user.model.js";

export const getUserAddressesService = async (userId, page, limit) => {
  try {
    const skip = (page - 1) * limit;
    const addresses = await Address.find({ userId })
      .sort({ isDefault: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const totalAddress = await Address.countDocuments({ userId });
    return {
      success: true,
      addresses,
      totalPages: Math.ceil(totalAddress / limit),
    };
  } catch (error) {
    console.error("Service error (get addresses):", error);
    return { success: false, message: "Something went wrong" };
  }
};

export const addAddressService = async (userId, data) => {
  try {
    const { fullName, phone, pincode, streetAddress, city, state, addressType, isDefault } = data;

    const hasAddress = await Address.exists({ userId });

    // First address is always default; otherwise respect the isDefault flag
    const makeDefault = !hasAddress || isDefault === "true" || isDefault === true;
    if (makeDefault) {
      await Address.updateMany({ userId }, { $set: { isDefault: false } });
    }

    const address = await Address.create({
      userId,
      fullName,
      phone,
      streetAddress,
      city,
      state,
      pincode,
      addressType: addressType || "Home",
      isDefault: makeDefault,
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
    const { _method, _id, userId: _uid, isDefault, ...updateData } = data;

    if (isDefault === "true" || isDefault === true) {
      await Address.updateMany({ userId }, { $set: { isDefault: false } });
      updateData.isDefault = true;
    }

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

export const setDefaultAddressService = async (userId, addressId) => {
  try {
    await Address.updateMany({ userId }, { $set: { isDefault: false } });

    const updated = await Address.findOneAndUpdate(
      { _id: addressId, userId },
      { $set: { isDefault: true } },
      { new: true }
    );

    if (!updated) {
      return { success: false, message: "Address not found" };
    }

    return { success: true, message: "Default address updated" };
  } catch (error) {
    console.error("Service error (set default):", error);
    return { success: false, message: "Something went wrong" };
  }
};

export const deleteAddressService = async (userId, addressId) => {
  try {
    const deletedAddress = await Address.findOneAndDelete({ _id: addressId, userId });

    if (!deletedAddress) {
      return { success: false, message: "Could not delete address" };
    }

    // If the deleted address was the default, promote the most recent remaining one
    if (deletedAddress.isDefault) {
      const next = await Address.findOne({ userId }).sort({ createdAt: -1 });
      if (next) {
        next.isDefault = true;
        await next.save();
      }
    }

    await User.findByIdAndUpdate(userId, { $pull: { addresses: addressId } });
    return { success: true, message: "Address deleted successfully" };
  } catch (error) {
    console.error("Service error (delete address):", error);
    return { success: false, message: "Something went wrong" };
  }
};
