import User from "../../models/userModel.js";

// show customers


  


// Show Customers Page
export const showCustomers = async (req, res) => {
  try {

    const page = parseInt(req.query.page) || 1;
    const limit = 8;
    const skip = (page - 1) * limit;
    const search = req.query.search || "";

    const query = {
      role: "user",
      $or: [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } }
      ]
    };

    const customers = await User.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);
   console.log(customers)
    const totalCustomers = await User.countDocuments(query);

    const totalPages = Math.ceil(totalCustomers / limit);

    res.render("admin/customers", {
       layout: "layouts/admin" ,path: '/admin/customers',
      customers,
      currentPage: page,
      totalPages,
      search
    });

  } catch (error) {
    console.error("Show customers error:", error);
    res.status(500).send("Server Error");
  }
};



// Block / Unblock Customer
export const toggleCustomerStatus = async (req, res) => {
  try {

    const { id } = req.params;

    const user = await User.findById(id);

    if (!user || user.role !== "user") {
      return res.redirect("/admin/customers");
    }

    user.isBlocked = !user.isBlocked;

    await user.save();

    res.redirect("/admin/customers");

  } catch (error) {
    console.error("Toggle status error:", error);
    res.redirect("/admin/customers");
  }
};