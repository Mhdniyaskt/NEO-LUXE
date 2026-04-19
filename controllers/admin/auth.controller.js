import { loginAdminService } from "../../services/admin.service.js";


export const getAdminLogin = (req, res) => {

  res.render("admin/login", { layout: "layouts/admin" });
};


export const handleAdminLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

   
    const result = await loginAdminService(email, password);

    if (!result.success) {
      return res.json(result);
    }

    
    req.session.admin = result.admin;

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

    res.clearCookie("connect.sid");
    res.redirect("/admin/login");
  });
};