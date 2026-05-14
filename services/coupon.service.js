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

    // Expiry date must be in the future
    const expiry = new Date(data.expiryDate);
    const today  = new Date();
    today.setHours(0, 0, 0, 0);
    if (expiry <= today) {
        throw new Error('Expiry date must be a future date');
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
    const today  = new Date();
    today.setHours(0, 0, 0, 0);

    // Expiry must be today or future (allow today so admin can set same-day expiry)
    if (expiry < today) {
        throw new Error('Expiry date must be today or a future date');
    }

    // Re-derive status from the new expiry date
    const newStatus = expiry <= new Date() ? 'expired' : 'active';

    const couponData = {
        ...data,
        discount:   Number(data.discount),
        maxCap:     Number(data.maxCap),
        minSpend:   Number(data.minSpend),
        usageLimit: Number(data.usageLimit),
        expiryDate: expiry,
        status:     newStatus,
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
 * Logic for calculating discounts and checking constraints
 */
export const validateCoupon = async (code, orderAmount) => {
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

    // Check Minimum Spend
    if (orderAmount < coupon.minSpend) {
        throw new Error(`Minimum spend of ₹${coupon.minSpend} required`);
    }

    // Calculate Discount
    let discountAmount = (orderAmount * coupon.discount) / 100;
    
    // Apply Max Cap (₹)
    if (coupon.maxCap > 0 && discountAmount > coupon.maxCap) {
        discountAmount = coupon.maxCap;
    }

    return {
        coupon,
        discountAmount,
        finalAmount: orderAmount - discountAmount
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