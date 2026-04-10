import express from "express"
import { getAdminLogin, handleAdminLogin, handleAdminLogout } from "../controllers/admin/authController.js";
import { showAdminDashboard } from "../controllers/admin/dasboardController.js";
import { showCustomers, toggleCustomerStatus } from "../controllers/admin/customersController.js";
import { isAdmin, isLogout } from "../middleware/adminAuth.js";

const router=express.Router()


 router.route("/login").get(isLogout,getAdminLogin)
 .post(isLogout,handleAdminLogin)


 router.get("/dashboard",isAdmin,showAdminDashboard)

 router.get('/customers',isAdmin,showCustomers)

 

router.post("/logout",isAdmin, handleAdminLogout);

router.patch('/customers/toggle/:id',isAdmin, toggleCustomerStatus);


export default router;