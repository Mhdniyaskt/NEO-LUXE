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
import { getSalesReport } from "../controllers/admin/sales-report.controller.js";
import { getAdminReferrals } from "../controllers/admin/referral.controller.js";

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
router.get("/dashboard/chart-data", dashboardController.getChartData);

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

// Route for replacing a specific image in a variant
router.put(
  "/products/:productId/variants/:variantId/replace-image",
  upload.single('image'),
  productController.replaceVariantImage,
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
  .put(
    upload.any(),
    (req, res, next) => {
      // ═══ DEFINITIVE DEBUG: Log everything multer produced ═══
      const fileCount = (req.files || []).length;
      const bodyKeys = Object.keys(req.body || {});
      const variantKeys = bodyKeys.filter(k => k.startsWith('variants['));
      const imageKeys = bodyKeys.filter(k => k.includes('Image') || k.includes('image'));
      
      console.log(`\n${'═'.repeat(70)}`);
      console.log(`[MULTER DEBUG] PUT /admin/products/edit/${req.params.id}`);
      console.log(`[MULTER DEBUG] Content-Type: ${req.headers['content-type']?.substring(0, 60)}...`);
      console.log(`[MULTER DEBUG] Content-Length: ${req.headers['content-length']} bytes`);
      console.log(`[MULTER DEBUG] Files: ${fileCount}`);
      if (fileCount > 0) {
        req.files.forEach((f, i) => {
          console.log(`[MULTER DEBUG]   ✓ file[${i}]: fieldname="${f.fieldname}", size=${f.size}, mime=${f.mimetype}, buffer=${f.buffer ? f.buffer.length + ' bytes' : 'MISSING!'}`);
        });
      } else {
        console.log(`[MULTER DEBUG]   ⚠️  NO FILES — blobs did not reach the server!`);
      }
      console.log(`[MULTER DEBUG] Body fields: ${bodyKeys.length} total, ${variantKeys.length} variant fields`);
      console.log(`[MULTER DEBUG] Variant IDs: ${variantKeys.filter(k => k.includes('[_id]')).map(k => req.body[k]).join(', ') || 'none'}`);
      console.log(`${'═'.repeat(70)}\n`);
      next();
    },
    productController.postEditProduct
  );

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


// @route    GET /admin/coupons
// @desc     Display the Coupon Management dashboard
router.get('/coupons', getAllCoupons);

// @route    POST /admin/coupons/add
// @desc     Create a new coupon
router.post('/coupons/add', createCoupon);

// @route    PUT /admin/coupons/update/:id
// @desc     Update coupon details (RESTful PUT)
router.put('/coupons/update/:id', updateCoupon);

// @route    DELETE /admin/coupons/delete/:id
// @desc     Delete a coupon (RESTful DELETE)
router.delete('/coupons/delete/:id', deleteCoupon);

router.patch('/coupons/toggle-status/:id', toggleStatus);

// Sales Report
router.get('/sales-report', getSalesReport);

// Referrals
router.get('/referrals', getAdminReferrals);

export default router;
