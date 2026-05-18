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
import { createCoupon, deleteCoupon, getAllCoupons, toggleStatus, updateCoupon } from "../controllers/admin/coupon.controller.js";
import { getSalesReport, downloadSalesReportPDF, downloadSalesReportExcel } from "../controllers/admin/sales-report.controller.js";
import { getAdminReferrals } from "../controllers/admin/referral.controller.js";

const router = express.Router();

// ═══ PUBLIC (Login) ═══
router.route("/login")
  .get(noCache, isLogout, adminAuthController.getAdminLogin)
  .post(isLogout, adminAuthController.handleAdminLogin);

// ═══ PROTECTED — all routes below require isAdmin ═══
router.use(isAdmin);

router.post("/logout", adminAuthController.handleAdminLogout);

// ═══ DASHBOARD ═══
router.get("/dashboard", noCache, dashboardController.showAdminDashboard);
router.get("/dashboard/chart-data", dashboardController.getChartData);

// ═══ CUSTOMERS ═══
router.get("/customers", noCache, customersController.showCustomers);
router.patch("/customers/:id/status", customersController.toggleCustomerStatus);

// ═══ CATEGORIES ═══
router.get("/categories", categoryCtrl.getCategory);
router.post("/categories", categoryCtrl.addCategory);
router.put("/categories", categoryCtrl.editCategory);
router.patch("/categories/:id/toggle", categoryCtrl.toggleCategory);
router.delete("/categories/:id", categoryCtrl.softDeleteCategory);

// ═══ PRODUCTS ═══
router.get("/products", noCache, productController.getProductPage);
router.get("/products/check-name", productController.checkProductName);

router.route("/products/add")
  .get(noCache, productController.getaddProducts)
  .post(upload2.any(), productController.postAddProducts);

router.route("/products/edit/:id")
  .get(noCache, productController.geteditProduct)
  .put(upload.any(), productController.postEditProduct);

router.patch("/products/:id/delete", productController.softDeleteProduct);
router.patch("/products/:id/toggle", productController.toggleProductStatus);

router.delete("/products/:productId/variants/:variantId/images", productController.deleteVariantImage);
router.put("/products/:productId/variants/:variantId/replace-image", upload.single('image'), productController.replaceVariantImage);

// ═══ ORDERS ═══
router.get("/orders", noCache, orderController.getOrders);
router.get("/orders/:id", noCache, orderController.getOrderDetail);
router.patch("/orders/:id/status", orderController.updateOrderStatus);
router.patch("/orders/:id/return", orderController.handleReturn);
router.patch("/orders/:id/restock", orderController.restockReturnedItems);

// ═══ STOCK ═══
router.get("/stock", noCache, stockController.getStockPage);
router.patch("/stock/:variantId", stockController.updateStock);

// ═══ COUPONS ═══
router.route("/coupons")
  .get(getAllCoupons)
  .post(createCoupon);

router.route("/coupons/:id")
  .put(updateCoupon)
  .delete(deleteCoupon);

router.patch("/coupons/:id/toggle", toggleStatus);

// ═══ SALES REPORT ═══
router.get("/sales-report", getSalesReport);
router.get("/sales-report/download/pdf", downloadSalesReportPDF);
router.get("/sales-report/download/excel", downloadSalesReportExcel);

// ═══ REFERRALS ═══
router.get("/referrals", getAdminReferrals);

// ═══ 404 CATCH-ALL (must be last) ═══
router.use((req, res) => {
  res.status(404).render("admin/404", { layout: "layouts/admin" });
});

export default router;
