import bcrypt from "bcrypt";
import User from "../../models/userModel.js";

// admin login

export const getAdminLogin = (req, res) => {
  res.render("admin/login", { layout: "layouts/admin" });
};



export const handleAdminLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.json({
        success: false,
        message: "All fields are required"
      });
    }

    const admin = await User.findOne({ email, role: "admin" });

    if (!admin) {
      return res.json({
        success: false,
        message: "Unauthorized access"
      });
    }

    const isMatch = await bcrypt.compare(password, admin.password);

    if (!isMatch) {
        return res.json({
        success: false,
        message: "Invalid credentials"
      });
    }
 // store admin in session
    req.session.admin = {
      id: admin._id,
      email: admin.email,
      role: admin.role
    };

    return res.json({
      success: true,
      message: "Login successful",
      redirect: "/admin/dashboard"
    });
  } catch (error) {
    console.error("Admin login error:", error);
     return res.json({
      success: false,
      message: "Something went wrong"
    });
  }
};


// // Logout

// export const adminLogout = (req, res) => {
//   res.clearCookie("adminAccessToken");
//   res.clearCookie("adminRefreshToken");

//   res.redirect("/admin");
// };