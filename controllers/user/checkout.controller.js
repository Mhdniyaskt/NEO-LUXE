import Razorpay from "razorpay";
import crypto from "crypto";
import asyncHandler from "../../utils/asyncHandler.util.js";
import {
  getCheckoutDataService,
  validateBuyNowService,
  validateCheckoutService,
  getCartTotalsService,
  processCheckoutService,
  processRazorpayOrderService,
} from "../../services/checkout.service.js";
import { getUserAddressesService } from "../../services/address.service.js";
import { getOrderByIdService } from "../../services/order.service.js";
import { creditWalletService } from "../../services/wallet.service.js";
import { calcOrderTotals, calcSubtotal, validateCalculationInputs } from "../../utils/orderCalc.util.js";
import { validateOrderCalculation, debugOrderCalculation } from "../../utils/calculation.validator.js";
import Coupon from "../../models/coupon.model.js";
import User from "../../models/user.model.js";
import PDFDocument from "pdfkit";

// ─── Razorpay instance ────────────────────────────────────────────────────────
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /checkout
// ═══════════════════════════════════════════════════════════════════════════════
export const getCheckout = asyncHandler(async (req, res) => {
  const userId = req.session.user.id;
  const result = await getCheckoutDataService(userId);

  if (!result.success) {
    if (result.message === "Cart is empty") return res.redirect("/cart");
    req.session.cartFlash = result.message;
    return res.redirect("/cart");
  }

  const { checkout } = result;

  // Get wallet balance to show on checkout page
  const userDoc = await User.findById(userId).select("walletBalance").lean();

  res.render("user/checkout", {
    layout: "layouts/user",
    path: "checkout",
    checkoutItems: checkout.items,
    addresses: checkout.addresses,
    totals: checkout.totals,coupons: checkout.coupons,
    blockedItems: checkout.issues.blockedItems.map(b => b.reason),
    stockErrors: checkout.issues.stockErrors,
    razorpayKeyId: process.env.RAZORPAY_KEY_ID,
    walletBalance: userDoc?.walletBalance || 0,
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /checkout/place-order  — COD / Wallet
// ═══════════════════════════════════════════════════════════════════════════════
export const placeOrder = asyncHandler(async (req, res) => {
  const userId = req.session.user.id;
  const { addressId, paymentMethod, couponCode } = req.body;

  if (!addressId || !paymentMethod)
    return res.status(400).json({ success: false, message: "Address and payment method are required" });

  if (!["cod", "wallet"].includes(paymentMethod))
    return res.status(400).json({ success: false, message: "Use the Razorpay flow for online payments" });

  const validation = await validateCheckoutService(userId, addressId);
  if (!validation.success) return res.status(400).json(validation);

  const result = await processCheckoutService({
    userId,
    addressId,
    paymentMethod,
    isBuyNow:   false,
    couponCode: couponCode || null,
    // discount is intentionally NOT forwarded — server resolves it from couponCode
  });

  if (result.success) {
    return res.json({
      success:     true,
      message:     result.message,
      orderId:     result.order._id,
      orderNumber: result.order.orderNumber,
      redirect:    `/orders/${result.order._id}`,
    });
  }

  return res.status(400).json(result);
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /checkout/razorpay/create-order
// Step 1: Validate cart + address, compute amount server-side, create Razorpay order.
// NO stock deduction, NO DB order created here.
// ═══════════════════════════════════════════════════════════════════════════════
export const createRazorpayOrder = asyncHandler(async (req, res) => {
  const userId = req.session.user.id;
  const { addressId, couponCode } = req.body;

  if (!addressId)
    return res.status(400).json({ success: false, message: "Address is required" });

  const validation = await validateCheckoutService(userId, addressId);
  if (!validation.success) return res.status(400).json(validation);

  // Get fresh cart totals — no side effects
  const totalsResult = await getCartTotalsService(userId);
  if (!totalsResult.success) return res.status(400).json(totalsResult);

  // Resolve coupon server-side so Razorpay amount matches what order service will use
  let discountAmount = 0;
  if (couponCode) {
    try {
      const coupon = await Coupon.findOne({
        code:       couponCode.trim().toUpperCase(),
        status:     'active',
        expiryDate: { $gt: new Date() },
      });
      if (coupon && coupon.usedCount < coupon.usageLimit) {
        const subtotal = totalsResult.totals.subtotal;
        if (subtotal >= coupon.minSpend) {
          let d = (subtotal * coupon.discount) / 100;
          if (coupon.maxCap > 0 && d > coupon.maxCap) d = coupon.maxCap;
          discountAmount = Math.round(d);
        }
      }
    } catch { /* ignore — just use discountAmount = 0 */ }
  }

  // Use shared utility so Razorpay amount = what will be saved in DB
  const totals      = calcOrderTotals(totalsResult.totals.subtotal, discountAmount);
  
  // Validate calculation inputs
  const calcValidation = validateCalculationInputs(totalsResult.totals.subtotal, discountAmount);
  if (!calcValidation.isValid) {
    return res.status(400).json({ success: false, message: calcValidation.error });
  }
  
  const finalAmount = totals.total;

  let rzpOrder;
  try {
    rzpOrder = await razorpay.orders.create({
      amount:   Math.round(finalAmount * 100),
      currency: "INR",
      receipt:  `ord_${userId.toString().slice(-8)}_${Date.now().toString().slice(-8)}`,
    });
  } catch (rzpErr) {
    console.error("Razorpay order creation failed:", rzpErr);
    return res.status(500).json({
      success: false,
      message: "Payment gateway error. Please try again or use Cash on Delivery.",
    });
  }

  // Store only couponCode in session — discount will be re-resolved at verify time
  req.session.razorpayPending = {
    addressId,
    razorpayOrderId: rzpOrder.id,
    couponCode:      couponCode || null,
  };

  return res.json({
    success:         true,
    razorpayOrderId: rzpOrder.id,
    amount:          rzpOrder.amount,
    currency:        rzpOrder.currency,
    keyId:           process.env.RAZORPAY_KEY_ID,
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /checkout/razorpay/verify
// Step 2 of Razorpay flow (called from Razorpay handler callback):
//   - Verify HMAC signature
//   - THEN try to deduct stock atomically + create DB order
//   - If stock ran out (race condition): initiate Razorpay refund automatically
// ═══════════════════════════════════════════════════════════════════════════════
export const verifyRazorpayPayment = asyncHandler(async (req, res) => {
  const userId = req.session.user.id;
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } =
    req.body;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature)
    return res
      .status(400)
      .json({ success: false, message: "Missing payment details" });

  // Retrieve addressId stored before the popup opened
  const pending = req.session.razorpayPending;
  if (!pending || pending.razorpayOrderId !== razorpay_order_id) {
    return res
      .status(400)
      .json({
        success: false,
        message: "Invalid payment session. Please try again.",
      });
  }

  // ── Verify HMAC-SHA256 signature ──────────────────────────────────────────
  const expectedSignature = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest("hex");

  if (expectedSignature !== razorpay_signature) {
    delete req.session.razorpayPending;
    return res
      .status(400)
      .json({
        success: false,
        message: "Payment verification failed. Please contact support.",
      });
  }

  // ── Signature valid — NOW try to create order + deduct stock atomically ───
  const result = await processRazorpayOrderService({
    userId,
    addressId:         pending.addressId,
    razorpayPaymentId: razorpay_payment_id,
    razorpayOrderId:   razorpay_order_id,
    couponCode:        pending.couponCode || null,
    // discount is intentionally NOT forwarded — service resolves from couponCode
  });

  // Clear pending session data regardless of outcome
  delete req.session.razorpayPending;

  if (result.success) {
    return res.json({
      success: true,
      message: "Payment verified and order placed successfully",
      redirect: `/orders/${result.order._id}`,
    });
  }

  // ── Stock ran out (race condition) — user paid but we can't fulfil ────────
  // Credit payment amount to wallet INSTANTLY instead of 5-7 day Razorpay refund
  if (result.outOfStock) {
    // Get the Razorpay order amount (in paise → convert to rupees)
    let amountToRefund = 0;
    let walletCredited = false;
    let walletBalance = 0;
    
    try {
      const rzpOrder = await razorpay.orders.fetch(razorpay_order_id);
      amountToRefund = rzpOrder.amount / 100; // paise to rupees
    } catch (fetchErr) {
      console.error('Could not fetch Razorpay order amount:', fetchErr.message);
      // Fallback: try to get from cart totals
      const totalsResult = await getCartTotalsService(userId).catch(() => null);
      if (totalsResult?.totals) {
        amountToRefund = totalsResult.totals.total;
      }
    }

    // Credit wallet instantly
    if (amountToRefund > 0) {
      try {
        const walletResult = await creditWalletService({
          userId,
          amount: amountToRefund,
          description: `Instant refund for out of stock item (Order: ${razorpay_order_id})`,
          category: 'refund',
        });
        
        if (walletResult.success) {
          walletCredited = true;
          walletBalance = walletResult.balance;
          console.log(`✅ Wallet credited ₹${amountToRefund} for user ${userId} — stock exhausted during payment`);
        } else {
          throw new Error(walletResult.message || 'Wallet credit failed');
        }
      } catch (walletErr) {
        console.error(`❌ Wallet credit failed for user ${userId}:`, walletErr.message);
        
        // Fallback to Razorpay refund if wallet credit fails
        try {
          const refundResult = await razorpay.payments.refund(razorpay_payment_id, {
            speed: "optimum",
            notes: { 
              reason: "Out of stock during payment - wallet credit failed, processing Razorpay refund",
              userId: userId.toString(),
              originalAmount: amountToRefund
            },
          });
          console.log(`⏳ Fallback: Razorpay refund initiated for payment ${razorpay_payment_id} - will take 5-7 business days`);
        } catch (refundErr) {
          console.error(`💥 CRITICAL: Both wallet credit AND Razorpay refund failed for payment ${razorpay_payment_id}:`, refundErr.message);
          // Log this for manual intervention
          console.error(`MANUAL INTERVENTION REQUIRED: User ${userId}, Payment ${razorpay_payment_id}, Amount ${amountToRefund}`);
        }
      }
    }

    return res.status(409).json({
      success: false,
      outOfStock: true,
      walletCredited,
      refundAmount: amountToRefund,
      walletBalance,
      message: walletCredited 
        ? `Product went out of stock during payment. ₹${amountToRefund.toLocaleString('en-IN')} has been instantly credited to your wallet.`
        : `Product went out of stock during payment. Refund of ₹${amountToRefund.toLocaleString('en-IN')} will be processed to your original payment method in 5-7 business days.`,
    });
  }

  // Other error (address gone, cart empty, etc.)
  return res.status(400).json({ success: false, message: result.message });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /checkout/razorpay/failed
// Called when user dismisses popup or payment.failed fires
// No order exists yet — nothing to clean up
// ═══════════════════════════════════════════════════════════════════════════════
export const handleRazorpayFailure = asyncHandler(async (req, res) => {
  // Clear any pending session data
  delete req.session.razorpayPending;
  return res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /checkout/apply-coupon
// Uses the SAME coupon resolution logic as the order service so preview = saved
// ═══════════════════════════════════════════════════════════════════════════════
export const applyCoupon = asyncHandler(async (req, res) => {
  const { code, subtotal } = req.body;

  if (!code || !subtotal)
    return res.status(400).json({ success: false, message: 'Coupon code and subtotal are required' });

  try {
    const sub = Number(subtotal);

    // Mirror exactly what resolveCoupon() does inside checkout.service.js
    const coupon = await Coupon.findOne({
      code:       code.trim().toUpperCase(),
      status:     'active',
      expiryDate: { $gt: new Date() },
    });

    if (!coupon) throw new Error('Invalid or expired coupon');
    if (coupon.usedCount >= coupon.usageLimit) throw new Error('Coupon usage limit reached');
    if (sub < coupon.minSpend) throw new Error(`Minimum order of ₹${coupon.minSpend} required to use this coupon`);

    let discountAmount = (sub * coupon.discount) / 100;
    if (coupon.maxCap > 0 && discountAmount > coupon.maxCap) discountAmount = coupon.maxCap;
    discountAmount = Math.round(discountAmount);

    // Compute what the totals will look like with this coupon applied
    const totals = calcOrderTotals(sub, discountAmount);
    
    // Validate the calculation
    const calcValidation = validateCalculationInputs(sub, discountAmount);
    if (!calcValidation.isValid) {
      return res.status(400).json({ success: false, message: calcValidation.error });
    }

    return res.json({
      success:        true,
      message:        `Coupon "${coupon.code}" applied! You save ₹${discountAmount.toLocaleString('en-IN')}`,
      discountAmount,
      couponCode:     coupon.code,
      couponTitle:    coupon.title,
      // Return the full breakdown so the checkout page can update all fields correctly
      totals,
    });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /checkout/remove-coupon
// ═══════════════════════════════════════════════════════════════════════════════
export const removeCoupon = asyncHandler(async (req, res) => {
  delete req.session.appliedCoupon;
  return res.json({ success: true, message: 'Coupon removed' });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /buy-now/:productId/:variantId
// ═══════════════════════════════════════════════════════════════════════════════
export const getBuyNow = asyncHandler(async (req, res) => {
  const userId = req.session.user.id;
  const { productId, variantId } = req.params;
  const { quantity = 1 } = req.query;

  const validation = await validateBuyNowService(
    productId,
    variantId,
    quantity,
  );
  if (!validation.success) {
    // Return JSON so frontend fetch can show proper error message
    return res.status(400).json({ success: false, message: validation.message });
  }

  const addressResult = await getUserAddressesService(userId, 1, 50);
  const addresses = addressResult.success ? addressResult.addresses : [];
  const { buyNow } = validation;

  // Get wallet balance
  const userDoc = await User.findById(userId).select("walletBalance").lean();

  const buyNowCheckoutItem = {
    productId: buyNow.item.product._id,
    variantId: buyNow.item.variant._id,
    productName: buyNow.item.product.name,
    brand: buyNow.item.product.brand || "",
    color: buyNow.item.variant.color,
    imageUrl:
      buyNow.item.variant.images?.[0]?.url ||
      buyNow.item.product.images?.[0]?.url ||
      null,
    quantity: buyNow.item.quantity,
    basePrice: buyNow.item.variant.basePrice,
    regularPrice:
      buyNow.item.variant.regularPrice ?? buyNow.item.variant.basePrice,
    finalPrice: buyNow.item.variant.finalPrice ?? buyNow.item.variant.basePrice,
    offerPercentage: buyNow.item.variant.offerPercentage || 0,
    offerSource: buyNow.item.variant.offerSource || 'none',
    itemTotal: buyNow.item.variant.finalPrice * buyNow.item.quantity,
  };

  res.render("user/checkout", {
    layout: "layouts/user",
    path: "checkout",
    checkoutItems: [buyNowCheckoutItem],
    addresses,
    totals: buyNow.totals,
    isBuyNow: true,
    blockedItems: [],
    stockErrors: [],
    razorpayKeyId: process.env.RAZORPAY_KEY_ID,
    walletBalance: userDoc?.walletBalance || 0,
    coupons: [],
    buyNowData: { productId, variantId, quantity: parseInt(quantity) },
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /buy-now/place-order
// ═══════════════════════════════════════════════════════════════════════════════
export const placeBuyNowOrder = asyncHandler(async (req, res) => {
  const userId = req.session.user.id;
  const { addressId, paymentMethod, productId, variantId, quantity } = req.body;

  if (!addressId || !paymentMethod || !productId || !variantId || !quantity)
    return res
      .status(400)
      .json({ success: false, message: "All fields are required" });

  if (paymentMethod !== "cod")
    return res
      .status(400)
      .json({ success: false, message: "Only COD is supported for Buy Now" });

  const validation = await validateCheckoutService(userId, addressId, [
    {
      productId,
      variantId,
      quantity: parseInt(quantity),
    },
  ]);
  if (!validation.success) return res.status(400).json(validation);

  const result = await processCheckoutService({
    userId,
    addressId,
    paymentMethod: "cod",
    items: [{ productId, variantId, quantity: parseInt(quantity) }],
    isBuyNow: true,
  });

  if (result.success) {
    return res.json({
      success: true,
      message: result.message,
      orderId: result.order._id,
      orderNumber: result.order.orderNumber,
      redirect: `/orders/${result.order._id}`,
    });
  }

  return res.status(400).json(result);
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /orders/:orderId  — order confirmation page
// ═══════════════════════════════════════════════════════════════════════════════
export const getOrderConfirmation = asyncHandler(async (req, res) => {
  const userId = req.session.user.id;
  const { orderId } = req.params;

  const result = await getOrderByIdService(orderId, userId);
  if (!result.success) {
    return res
      .status(404)
      .render("error", { message: "Order not found", layout: "layouts/user" });
  }

  const { order } = result;
  
  // Validate and fix calculation discrepancies
  const orderValidation = validateOrderCalculation(order);
  if (!orderValidation.isValid) {
    console.warn(`⚠️  Order ${orderId} has calculation discrepancies:`, orderValidation.discrepancies);
    
    // Log detailed debugging info
    if (process.env.NODE_ENV === 'development') {
      debugOrderCalculation(order);
    }
    
    // Use corrected calculations for display
    const correctedOrder = {
      ...order,
      ...orderValidation.corrected
    };
    
    return res.render("user/order-confirmation", {
      layout: "layouts/user",
      path: "orders",
      order: correctedOrder,
      calculationWarning: "Order calculations have been corrected for display"
    });
  }

  res.render("user/order-confirmation", {
    layout: "layouts/user",
    path: "orders",
    order: result.order,
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /orders/:orderId/invoice
// ═══════════════════════════════════════════════════════════════════════════════
export const downloadInvoice = asyncHandler(async (req, res) => {
  const userId = req.session.user.id;
  const { orderId } = req.params;

  const result = await getOrderByIdService(orderId, userId);
  if (!result.success)
    return res.status(404).json({ success: false, message: "Order not found" });

  const { order } = result;

  // Cancelled or returned orders — no invoice
  if (order.status === 'cancelled' || order.status === 'returned') {
    return res.status(400).json({
      success: false,
      message: "Invoice is not available for cancelled or returned orders",
    });
  }

  // For COD orders — only allow after delivery
  if (order.paymentMethod === 'cod' && order.status !== 'delivered') {
    return res.status(400).json({
      success: false,
      message: "Invoice for COD orders is available only after delivery",
    });
  }

  // For online/wallet — allow if payment is confirmed (paid)
  if ((order.paymentMethod === 'razorpay' || order.paymentMethod === 'wallet') && order.paymentStatus !== 'paid') {
    return res.status(400).json({
      success: false,
      message: "Invoice is available only for paid orders",
    });
  }

  const deliveredItems = order.items.filter(
    (i) => i.status !== "cancelled" && i.returnStatus !== "approved",
  );

  if (deliveredItems.length === 0) {
    return res.status(400).json({
      success: false,
      message: "No active items in this order to generate invoice",
    });
  }

  const subtotal = deliveredItems.reduce(
    (sum, i) => sum + (i.itemTotal || i.basePrice * i.quantity || 0),
    0,
  );
  // Scale coupon discount proportionally if some items were cancelled
  const fullSubtotal  = order.subtotal || subtotal;
  const scale         = fullSubtotal > 0 ? subtotal / fullSubtotal : 1;
  const discount      = Math.round((order.discount || 0) * scale);
  const invoiceTotals = calcOrderTotals(subtotal, discount);
  const { shipping, tax, total } = invoiceTotals;

  const doc = new PDFDocument({ margin: 50, size: "A4" });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename=invoice-${order.orderNumber || orderId.slice(-8).toUpperCase()}.pdf`,
  );
  doc.pipe(res);

  doc.rect(0, 0, 595, 120).fill("#05080d");
  doc
    .fillColor("#22d3ee")
    .fontSize(26)
    .font("Helvetica-Bold")
    .text("NEO LUXE", 50, 35);
  doc
    .fillColor("#94a3b8")
    .fontSize(10)
    .font("Helvetica")
    .text("Premium Watch Collection", 50, 65);
  doc
    .fillColor("#ffffff")
    .fontSize(22)
    .font("Helvetica-Bold")
    .text("INVOICE", 430, 40);
  doc
    .fillColor("#22d3ee")
    .fontSize(10)
    .font("Helvetica")
    .text(`#${order.orderNumber || orderId.slice(-8).toUpperCase()}`, 430, 68);

  let y = 140;
  doc.fillColor("#1e293b").rect(50, y, 495, 1).fill();
  y += 15;
  doc
    .fillColor("#64748b")
    .fontSize(8)
    .font("Helvetica-Bold")
    .text("ORDER DATE", 50, y);
  doc
    .fillColor("#64748b")
    .fontSize(8)
    .font("Helvetica-Bold")
    .text("PAYMENT METHOD", 220, y);
  doc
    .fillColor("#64748b")
    .fontSize(8)
    .font("Helvetica-Bold")
    .text("STATUS", 390, y);
  y += 14;
  doc
    .fillColor("#0f172a")
    .fontSize(10)
    .font("Helvetica")
    .text(
      new Date(order.createdAt).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "long",
        year: "numeric",
      }),
      50,
      y,
    );
  doc
    .fillColor("#0f172a")
    .fontSize(10)
    .font("Helvetica")
    .text(
      order.paymentMethod === "cod"
        ? "Cash on Delivery"
        : order.paymentMethod === "razorpay"
          ? "Razorpay"
          : "Online Payment",
      220,
      y,
    );
  const statusColor = order.status === 'delivered' ? '#16a34a' : order.status === 'cancelled' ? '#dc2626' : '#0891b2';
  doc
    .fillColor(statusColor)
    .fontSize(10)
    .font("Helvetica-Bold")
    .text(order.status.toUpperCase(), 390, y);
  y += 30;

  doc.fillColor("#1e293b").rect(50, y, 495, 1).fill();
  y += 20;
  doc
    .fillColor("#64748b")
    .fontSize(8)
    .font("Helvetica-Bold")
    .text("BILL TO", 50, y);
  y += 14;
  doc
    .fillColor("#0f172a")
    .fontSize(11)
    .font("Helvetica-Bold")
    .text(order.shippingAddress.fullName, 50, y);
  y += 16;
  const addr = [
    order.shippingAddress.addressLine1,
    order.shippingAddress.addressLine2,
    `${order.shippingAddress.city}, ${order.shippingAddress.state} ${order.shippingAddress.pincode}`,
  ]
    .filter(Boolean)
    .join(", ");
  doc
    .fillColor("#334155")
    .fontSize(10)
    .font("Helvetica")
    .text(addr, 50, y, { width: 250 });
  y += doc.heightOfString(addr, { width: 250 }) + 6;
  doc
    .fillColor("#334155")
    .fontSize(10)
    .text(`Phone: ${order.shippingAddress.phone}`, 50, y);
  y += 30;

  doc.fillColor("#0f172a").rect(50, y, 495, 28).fill();
  doc.fillColor("#ffffff").fontSize(9).font("Helvetica-Bold");
  doc.text("ITEM", 60, y + 9);
  doc.text("COLOR", 290, y + 9);
  doc.text("QTY", 360, y + 9, { width: 40, align: "center" });
  doc.text("UNIT PRICE", 410, y + 9, { width: 70, align: "right" });
  doc.text("TOTAL", 490, y + 9, { width: 55, align: "right" });
  y += 28;

  deliveredItems.forEach((item, idx) => {
    const rowBg = idx % 2 === 0 ? "#f8fafc" : "#f1f5f9";
    const unitPrice = item.basePrice || 0;
    const lineTotal = item.itemTotal || unitPrice * item.quantity || 0;
    doc.fillColor(rowBg).rect(50, y, 495, 26).fill();
    doc
      .fillColor("#0f172a")
      .fontSize(9)
      .font("Helvetica-Bold")
      .text(item.productName || "—", 60, y + 8, { width: 220, ellipsis: true });
    doc
      .fillColor("#475569")
      .fontSize(9)
      .font("Helvetica")
      .text(item.variantColor || "—", 290, y + 8, { width: 60 });
    doc
      .fillColor("#0f172a")
      .fontSize(9)
      .font("Helvetica")
      .text(String(item.quantity), 360, y + 8, { width: 40, align: "center" });
    doc
      .fillColor("#0f172a")
      .fontSize(9)
      .font("Helvetica")
      .text(`Rs.${unitPrice.toLocaleString("en-IN")}`, 410, y + 8, {
        width: 70,
        align: "right",
      });
    doc
      .fillColor("#0f172a")
      .fontSize(9)
      .font("Helvetica-Bold")
      .text(`Rs.${lineTotal.toLocaleString("en-IN")}`, 490, y + 8, {
        width: 55,
        align: "right",
      });
    y += 26;
  });

  y += 15;
  const totalsX = 370,
    valX = 490,
    valW = 55;
  doc.fillColor("#e2e8f0").rect(totalsX, y, 175, 1).fill();
  y += 12;
  doc
    .fillColor("#64748b")
    .fontSize(9)
    .font("Helvetica")
    .text("Subtotal", totalsX, y);
  doc
    .fillColor("#0f172a")
    .fontSize(9)
    .font("Helvetica")
    .text(`Rs.${subtotal.toLocaleString("en-IN")}`, valX, y, {
      width: valW,
      align: "right",
    });
  y += 16;
  doc
    .fillColor("#64748b")
    .fontSize(9)
    .font("Helvetica")
    .text("Shipping", totalsX, y);
  doc
    .fillColor(shipping === 0 ? "#16a34a" : "#0f172a")
    .fontSize(9)
    .font("Helvetica")
    .text(shipping === 0 ? "FREE" : `Rs.${shipping}`, valX, y, {
      width: valW,
      align: "right",
    });
  y += 16;
  doc
    .fillColor("#64748b")
    .fontSize(9)
    .font("Helvetica")
    .text("Tax (18% GST)", totalsX, y);
  doc
    .fillColor("#0f172a")
    .fontSize(9)
    .font("Helvetica")
    .text(`Rs.${tax.toLocaleString("en-IN")}`, valX, y, {
      width: valW,
      align: "right",
    });
  y += 16;
  if (discount > 0) {
    const couponLabel = order.couponCode ? `Coupon (${order.couponCode})` : 'Coupon Discount';
    doc.fillColor("#64748b").fontSize(9).font("Helvetica").text(couponLabel, totalsX, y);
    doc.fillColor("#16a34a").fontSize(9).font("Helvetica")
      .text(`-Rs.${discount.toLocaleString("en-IN")}`, valX, y, { width: valW, align: "right" });
    y += 16;
  }
  y -= 4;
  doc.fillColor("#e2e8f0").rect(totalsX, y, 175, 1).fill();
  y += 12;
  doc
    .fillColor("#0f172a")
    .rect(totalsX - 5, y - 4, 185, 28)
    .fill();
  doc
    .fillColor("#ffffff")
    .fontSize(11)
    .font("Helvetica-Bold")
    .text("TOTAL", totalsX, y + 4);
  doc
    .fillColor("#22d3ee")
    .fontSize(13)
    .font("Helvetica-Bold")
    .text(`Rs.${total.toLocaleString("en-IN")}`, valX - 10, y + 3, {
      width: valW + 10,
      align: "right",
    });
  y += 40;

  doc.fillColor("#e2e8f0").rect(50, y, 495, 1).fill();
  y += 15;
  doc
    .fillColor("#94a3b8")
    .fontSize(8)
    .font("Helvetica")
    .text(
      "Thank you for shopping with Neo Luxe. For support, contact us at support@neoluxe.com",
      50,
      y,
      { align: "center", width: 495 },
    );
  y += 14;
  doc
    .fillColor("#cbd5e1")
    .fontSize(7)
    .font("Helvetica")
    .text(
      "This is a computer-generated invoice and does not require a signature.",
      50,
      y,
      { align: "center", width: 495 },
    );

  doc.end();
});
