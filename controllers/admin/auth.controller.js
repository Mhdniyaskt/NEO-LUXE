import bcrypt from "bcrypt";
import User from "../../models/user.model.js";




export const getAdminLogin = (req, res) => {
  
    res.header('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    res.header('Expires', '-1');
    res.header('Pragma', 'no-cache');
    
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



export const handleAdminLogout = (req, res) => {
   
    req.session.destroy((err) => {
        if (err) {
            console.error("Logout error:", err);
            return res.status(500).send("Could not log out.");
        }

        // 2. Clear the session cookie (default name is 'connect.sid')
        res.clearCookie("connect.sid");

        // 3. Redirect to the login page
        res.redirect("/admin/login");
    });
};
