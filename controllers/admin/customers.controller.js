import User from "../../models/user.model.js";


export const showCustomers = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 6;
    const skip = (page - 1) * limit;
    const search = req.query.search || "";
    const status = req.query.status || "";

    // Build Query
    let query = { role: "user" };

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } }
      ];
    }

    if (status === "active") query.isBlocked = false;
    if (status === "blocked") query.isBlocked = true;

    // Fetch customers sorted by createdAt DESC (-1)
    const customers = await User.find(query)
      .sort({ createdAt: -1 }) 
      .skip(skip)
      .limit(limit);

    const totalCustomers = await User.countDocuments(query);
    const totalPages = Math.ceil(totalCustomers / limit);

    res.render("admin/customers", {
      layout: "layouts/admin",
      path: '/admin/customers',
      customers,
    
      currentPage: page,
      totalPages,
      search,
      status, // Passed to maintain select state
    });

  } catch (error) {
    console.error("Show customers error:", error);
    res.status(500).send("Server Error");
  }
};

// Toggle Status (Post/Patch recommended, but maintaining your redirect logic)
export const toggleCustomerStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findById(id);

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // Toggle the status
    user.isBlocked = !user.isBlocked;
    await user.save();

    // Send a JSON response back to the frontend
    return res.status(200).json({ 
      success: true, 
      isBlocked: user.isBlocked 
    });

  } catch (error) {
    console.error("Toggle status error:", error);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};   