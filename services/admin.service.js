import bcrypt from "bcrypt";
import User from "../models/user.model.js";
import { MESSAGES } from "../constants/messages.constant.js";

export const loginAdminService = async (email, password) => {
  try {
    if (!email || !password) {
      return { success: false, message: MESSAGES.GENERIC.ALL_FIELDS_REQUIRED };
    }

    const admin = await User.findOne({ email, role: "admin" });

    if (!admin) {
      return { success: false, message: MESSAGES.GENERIC.UNAUTHORIZED };
    }

    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) {
      return { success: false, message: MESSAGES.ADMIN.INVALID_CREDENTIALS };
    }

    return {
      success: true,
      admin: { id: admin._id, email: admin.email, role: admin.role }
    };
  } catch (error) {
    console.error("Service error:", error);
    return { success: false, message: MESSAGES.GENERIC.SOMETHING_WENT_WRONG };
  }
};

export const getCustomersService = async (page, limit, search, status) => {
  try {
    const skip = (page - 1) * limit;
    let query = { role: "user" };

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } }
      ];
    }

    if (status === "active")  query.isBlocked = false;
    if (status === "blocked") query.isBlocked = true;

    const customers = await User.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const totalCustomers = await User.countDocuments(query);
    const totalPages = Math.ceil(totalCustomers / limit);

    return { success: true, customers, totalPages };
  } catch (error) {
    console.error("Service error (customers):", error);
    return { success: false, message: MESSAGES.GENERIC.SOMETHING_WENT_WRONG };
  }
};

export const toggleCustomerStatusService = async (id) => {
  try {
    const user = await User.findById(id);

    if (!user) {
      return { success: false, message: MESSAGES.CUSTOMER.NOT_FOUND };
    }

    user.isBlocked = !user.isBlocked;
    await user.save();

    return { success: true, isBlocked: user.isBlocked };
  } catch (error) {
    console.error("Service error (toggle):", error);
    return { success: false, message: MESSAGES.GENERIC.SOMETHING_WENT_WRONG };
  }
};
