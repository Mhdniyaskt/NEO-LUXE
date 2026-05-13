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

    // Spread the data but override fields that need strict typing
    const couponData = {
        ...data,
        code: formattedCode,
        discount: Number(data.discount),
        maxCap: Number(data.maxCap),
        minSpend: Number(data.minSpend),
        usageLimit: Number(data.usageLimit),
        expiryDate: new Date(data.expiryDate) 
    };

    const coupon = new Coupon(couponData);
    return await coupon.save();
};

/**
 * Update coupon details
 */
// Service: couponService.js
export const updateCoupon = async (id, data) => {
    const couponData = {
        ...data,
        discount: Number(data.discount),
        maxCap: Number(data.maxCap),
        minSpend: Number(data.minSpend),
        usageLimit: Number(data.usageLimit),
        expiryDate: new Date(data.expiryDate)
    };

    const coupon = await Coupon.findByIdAndUpdate(id, couponData, {
        new: true,
        runValidators: true
    });
    
    if (!coupon) throw new Error('Coupon not found');
    return coupon;
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
    // findByIdAndUpdate returns the updated document if needed
    const updatedCoupon = await Coupon.findByIdAndUpdate(
        id, 
        { status }, 
        { new: true, runValidators: true }
    );

    if (!updatedCoupon) {
        throw new Error('Coupon not found');
    }

    return updatedCoupon;
};