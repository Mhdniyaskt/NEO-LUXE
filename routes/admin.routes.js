import express from "express";
import { noCache } from "../middleware/user/nocache.middleware.js";
import * as adminAuthController from "../controllers/admin/auth.controller.js";
import * as dashboardController from "../controllers/admin/dasboard.controller.js";
import * as customersController from "../controllers/admin/customers.controller.js";
import * as categoryCtrl from "../controllers/admin/category.controller.js";
import { isAdmin, isLogout } from "../middleware/admin/auth.middleware.js";

import { upload } from '../middleware/admin/upload.middleware.js';
import * as productController from '../controllers/admin/product.controller.js';

const router = express.Router();

// --- Auth Routes ---
router
  .route("/login")
  .get(noCache, isLogout, adminAuthController.getAdminLogin)
  .post(isLogout, adminAuthController.handleAdminLogin);

router.post("/logout", isAdmin, adminAuthController.handleAdminLogout);

// --- Dashboard & Customers ---
router.get(
  "/dashboard",
  noCache,
  isAdmin,
  dashboardController.showAdminDashboard,
);

router
  .route("/customers")
  .get(noCache, isAdmin, customersController.showCustomers);

router
  .route("/customers/:id/status")
  .patch(isAdmin, customersController.toggleCustomerStatus);

// --- Category Management ---
router.get("/categories", isAdmin, categoryCtrl.getCategory);
router.post("/add-category", isAdmin, categoryCtrl.addCategory);
router.post("/edit-category", isAdmin, categoryCtrl.editCategory);
router.patch("/toggle-category/:id", isAdmin, categoryCtrl.toggleCategory);
router.delete("/delete-category/:id", isAdmin, categoryCtrl.softDeleteCategory);

// --- NEO-LUXE Product Management ---

/**
 * 1. Product Listing
 * Includes Search, Brand Filter, and Pagination
 */
router.get('/products', noCache, isAdmin, productController.getProductPage);

/**
 * 2. Add Product Logic
 * upload.any() is used to capture variantImages_0, variantImages_1, etc.
 */
router
  .route('/products/add')
  .get(noCache, isAdmin, productController.getaddProducts)
  .post(isAdmin, upload.any(), productController.postAddProducts);
  // This will WORK with variantImages_0, variantImages_1, etc.


/**
 * 3. Edit Product Logic
 */
router
  .route('/products/edit/:id')
  .get(noCache, isAdmin, productController.geteditProduct)
  .post(isAdmin, upload.any(), productController.postEditProduct);

/**
 * 4. Product Details (API/AJAX fetch if needed)
 */
// router.get('/products/details/:id', isAdmin, productController.productDetails);

/**
 * 5. Action Logic
 * Soft delete (moves to trash)
 */
router.patch('/products/delete/:id', isAdmin, productController.softDeleteProduct);

export default router;