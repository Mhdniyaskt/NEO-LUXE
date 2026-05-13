const mongoose = require('mongoose');

const couponSchema = new mongoose.Schema({
    title: {
        type: String,
        required: [true, 'Coupon title is required'],
        trim: true
    },
    code: {
        type: String,
        required: [true, 'Coupon code is required'],
        unique: true,
        uppercase: true,
        trim: true
    },
    discount: {
        type: Number,
        required: [true, 'Discount percentage is required'],
        min: [1, 'Discount must be at least 1%'],
        max: [90, 'Discount cannot exceed 90%']
    },
    maxCap: {
        type: Number,
        required: [true, 'Maximum discount cap is required'],
        default: 0
    },
    minSpend: {
        type: Number,
        required: [true, 'Minimum spend requirement is required'],
        default: 0
    },
    usageLimit: {
        type: Number,
        required: [true, 'Usage limit is required'],
        default: 100
    },
    usedCount: {
        type: Number,
        default: 0
    },
    expiryDate: {
        type: Date,
        required: [true, 'Expiry date is required']
    },
    status: {
        type: String,
        enum: ['active', 'inactive', 'expired'],
        default: 'active'
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, { 
    timestamps: true 
});

/**
 * Virtual property to calculate remaining days
 * Used in your EJS table: <%= coupon.daysLeft %>
 */
couponSchema.virtual('daysLeft').get(function() {
    const today = new Date();
    const diffTime = this.expiryDate - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
    return diffDays > 0 ? diffDays : 0;
});

/**
 * Middleware to auto-update status if expired or limit reached
 */
couponSchema.pre('save', function(next) {
    const today = new Date();
    
    if (this.expiryDate < today) {
        this.status = 'expired';
    } else if (this.usedCount >= this.usageLimit) {
        this.status = 'inactive'; // Or a custom 'limit-reached' status
    }
    
    next();
});

// Ensure virtuals are included when converting to JSON or Object
couponSchema.set('toObject', { virtuals: true });
couponSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('Coupon', couponSchema);