import express from "express";

import { noCache } from "../middleware/user/nocache.middleware.js";
import * as adminAuthController from "../controllers/admin/auth.controller.js";
import * as dashboardController from "../controllers/admin/dasboard.controller.js";
import * as customersController from "../controllers/admin/customers.controller.js";


import { isAdmin, isLogout } from "../middleware/admin/auth.middleware.js";

const router = express.Router();


router
  .route("/login")
  .get(noCache,isLogout, adminAuthController.getAdminLogin)
  .post(isLogout, adminAuthController.handleAdminLogin);

router.post(
  "/logout",
  isAdmin,
  adminAuthController.handleAdminLogout
);


router.get(
  "/dashboard",
  noCache,isAdmin,
  dashboardController.showAdminDashboard
);



router
  .route("/customers")
  .get(noCache,isAdmin, customersController.showCustomers);

router
  .route("/customers/:id/status")
  .patch(isAdmin, customersController.toggleCustomerStatus);


export default router;