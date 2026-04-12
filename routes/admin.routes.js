import express from "express";


import * as adminAuthController from "../controllers/admin/auth.controller.js";
import * as dashboardController from "../controllers/admin/dasboard.controller.js";
import * as customersController from "../controllers/admin/customers.controller.js";


import { isAdmin, isLogout } from "../middleware/admin/auth.middleware.js";

const router = express.Router();


router
  .route("/login")
  .get(isLogout, adminAuthController.getAdminLogin)
  .post(isLogout, adminAuthController.handleAdminLogin);

router.post(
  "/logout",
  isAdmin,
  adminAuthController.handleAdminLogout
);


router.get(
  "/dashboard",
  isAdmin,
  dashboardController.showAdminDashboard
);



router
  .route("/customers")
  .get(isAdmin, customersController.showCustomers);

router
  .route("/customers/:id/status")
  .patch(isAdmin, customersController.toggleCustomerStatus);


export default router;