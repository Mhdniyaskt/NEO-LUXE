import Coupon from '../models/coupon.model.js';

/**
 * Fetch all coupons with calculated virtuals
 */
export const getAllCoupons = async () => {
    return await Coupon.find().sort({ createdAt: -1 });
};

/**
 * Create a new coupon with validation
 */
export const createCoupon = async (data) => {
    const formattedCode = data.code.trim().toUpperCase();

    const existing = await Coupon.findOne({ code: formattedCode });
    if (existing) {
        throw new Error('Coupon code already exists');
    }

    // Expiry date must be a valid date and at least tomorrow
    const expiry = new Date(data.expiryDate);
    if (isNaN(expiry.getTime())) {
        throw new Error('Invalid expiry date provided');
    }
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    if (expiry < tomorrow) {
        throw new Error('Expiry date must be a future date (from tomorrow onwards)');
    }

    const couponData = {
        ...data,
        code:       formattedCode,
        discount:   Number(data.discount),
        maxCap:     Number(data.maxCap),
        minSpend:   Number(data.minSpend),
        usageLimit: Number(data.usageLimit),
        expiryDate: expiry,
        status:     'active',
    };

    const coupon = new Coupon(couponData);
    return await coupon.save();
};

/**
 * Update coupon details
 * - If a future expiry date is set on an expired coupon → reactivate it
 * - Status is always re-derived from the new expiry date
 */
export const updateCoupon = async (id, data) => {
    const expiry = new Date(data.expiryDate);

    // Validate: expiry must be a valid date
    if (isNaN(expiry.getTime())) {
        throw new Error('Invalid expiry date provided');
    }

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);

    // Expiry must be at least tomorrow
    if (expiry < tomorrow) {
        throw new Error('Expiry date must be a future date (from tomorrow onwards)');
    }

    // Status is always 'active' when expiry is in the future (pre-save hook will mark expired if needed)
    const couponData = {
        ...data,
        discount:   Number(data.discount),
        maxCap:     Number(data.maxCap),
        minSpend:   Number(data.minSpend),
        usageLimit: Number(data.usageLimit),
        expiryDate: expiry,
        status:     'active',   // reactivates expired coupons when a future date is set
    };

    // Use findById + save so the pre('save') hook also runs
    const coupon = await Coupon.findById(id);
    if (!coupon) throw new Error('Coupon not found');

    Object.assign(coupon, couponData);
    return await coupon.save();
};

/**
 * Delete a coupon
 */
export const deleteCoupon = async (id) => {
    return await Coupon.findByIdAndDelete(id);
};

/**
 * VALIDATE COUPON (For Checkout Side)
 * @param {string} code       - Coupon code
 * @param {number} subtotal   - Product subtotal (pre-tax, pre-shipping) — used to calculate discount %
 * @param {number} orderTotal - Full order total (subtotal + tax + shipping) — used for minSpend check
 */
export const validateCoupon = async (code, subtotal, orderTotal = subtotal) => {
    const coupon = await Coupon.findOne({ 
        code: code.toUpperCase(), 
        status: 'active' 
    });

    if (!coupon) throw new Error('Invalid or expired coupon');
    
    // Check Date
    if (new Date() > new Date(coupon.expiryDate)) {
        throw new Error('Coupon has expired');
    }

    // Check Usage Limit
    if (coupon.usedCount >= coupon.usageLimit) {
        throw new Error('Coupon usage limit reached');
    }

    // Check Minimum Spend against the full order total (what the customer pays)
    if (orderTotal < coupon.minSpend) {
        throw new Error(`Minimum order of ₹${coupon.minSpend} required to use this coupon`);
    }

    // Calculate Discount — % applied to subtotal (product value only, excluding tax/shipping)
    let discountAmount = (subtotal * coupon.discount) / 100;
    
    // Apply Max Cap (₹)
    if (coupon.maxCap > 0 && discountAmount > coupon.maxCap) {
        discountAmount = coupon.maxCap;
    }

    return {
        coupon,
        discountAmount,
        finalAmount: orderTotal - discountAmount
    };
};

export const updateCouponStatus = async (id, status) => {
    const coupon = await Coupon.findById(id);
    if (!coupon) throw new Error('Coupon not found');

    // Expired coupons cannot be toggled — must be reactivated via edit
    if (coupon.status === 'expired') {
        throw new Error('Expired coupons cannot be toggled. Edit the coupon and set a future expiry date to reactivate it.');
    }

    if (!['active', 'inactive'].includes(status)) {
        throw new Error('Invalid status value');
    }

    coupon.status = status;
    return await coupon.save();
};