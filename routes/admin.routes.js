import express from "express";
import { noCache } from "../middleware/nocache.middleware.js";
import * as adminAuthController from "../controllers/admin/auth.controller.js";
import * as dashboardController from "../controllers/admin/dasboard.controller.js";
import * as customersController from "../controllers/admin/customers.controller.js";
import * as categoryCtrl from "../controllers/admin/category.controller.js";
import { isAdmin, isLogout } from "../middleware/auth.middleware.js";
import { upload, upload2 } from "../middleware/upload.middleware.js";
import * as productController from "../controllers/admin/product.controller.js";
import * as orderController from "../controllers/admin/order.controller.js";
import * as stockController from "../controllers/admin/stock.controller.js";

const router = express.Router();

// ═══ PUBLIC ADMIN ROUTES (Login) ═══
router
  .route("/login")
  .get(noCache, isLogout, adminAuthController.getAdminLogin)
  .post(isLogout, adminAuthController.handleAdminLogin);

// ═══ PROTECTED ADMIN ROUTES ═══
// Everything below this line will automatically check for isAdmin
router.use(isAdmin);

router.post("/logout", adminAuthController.handleAdminLogout);

router.get("/dashboard", noCache, dashboardController.showAdminDashboard);

router.get("/customers", noCache, customersController.showCustomers);
router.patch("/customers/:id/status", customersController.toggleCustomerStatus);

// Categories
router.get("/categories", categoryCtrl.getCategory);
router.post("/add-category", categoryCtrl.addCategory);
router.put("/edit-category", categoryCtrl.editCategory);
router.patch("/toggle-category/:id", categoryCtrl.toggleCategory);
router.delete("/delete-category/:id", categoryCtrl.softDeleteCategory);

// Route for deleting a specific image from a variant (imageUrl passed in request body)
router.delete(
  "/products/:productId/variants/:variantId/images",
  productController.deleteVariantImage,
);
// Products
router.get("/products", noCache, productController.getProductPage);
router.get("/products/check-name", productController.checkProductName);

router
  .route("/products/add")
  .get(noCache, productController.getaddProducts)
  .post(upload2.any(), productController.postAddProducts);

router
  .route("/products/edit/:id")
  .get(noCache, productController.geteditProduct)
  .put(upload.any(), productController.postEditProduct);

router.patch("/products/delete/:id", productController.softDeleteProduct);
router.patch("/products/toggle/:id", productController.toggleProductStatus);

// Orders
router.get("/orders", noCache, orderController.getOrders);
router.get("/orders/:id", noCache, orderController.getOrderDetail);
router.patch("/orders/:id/status", orderController.updateOrderStatus);
router.patch("/orders/:id/return", orderController.handleReturn);
router.patch("/orders/:id/restock", orderController.restockReturnedItems);

// Stock / Inventory
router.get("/stock", noCache, stockController.getStockPage);
router.patch("/stock/:variantId", stockController.updateStock);

export default router;
