import express from "express"
import { getAdminLogin, handleAdminLogin } from "../controllers/admin/authController.js";
import { showAdminDashboard } from "../controllers/admin/dasboardController.js";
import { showCustomers, toggleCustomerStatus } from "../controllers/admin/customersController.js";

const router=express.Router()


 router.get("/login",getAdminLogin)

 router.post("/login",handleAdminLogin)


 router.get("/dashboard",showAdminDashboard)

 router.get('/customers',showCustomers)

 

// This matches the form action: /admin/customers/toggle/:id
// We use :id as a dynamic parameter
router.patch('/customers/toggle/:id', toggleCustomerStatus);
// router.get("/customers",customers)


export default router;