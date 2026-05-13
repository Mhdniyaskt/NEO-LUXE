
import * as couponService from '../../services/coupon.service.js';

/**
 * GET ALL COUPONS
 * Path: /admin/coupons
 */
export const getAllCoupons = async (req, res) => {
    try {
        const coupons = await couponService.getAllCoupons();
        res.render('admin/coupons', { 
            coupons, 
            path: 'coupons' ,
            layout: 'layouts/admin'

        });
    } catch (error) {
        res.status(500).render('error', { message: error.message });
    }
};

/**
 * CREATE NEW COUPON
 * Path: /admin/coupons/add
 */
export const createCoupon = async (req, res) => {
    try {
        await couponService.createCoupon(req.body);
        res.redirect('/admin/coupons');
    } catch (error) {
        // Tip: Use req.flash('error', error.message) for better UX
        res.status(400).send(error.message);
    }
};

/**
 * UPDATE EXISTING COUPON
 * Path: /admin/coupons/update/:id
 */
// Controller: couponController.js
export const updateCoupon = async (req, res) => {
    try {
        await couponService.updateCoupon(req.params.id, req.body);
        
        // CHANGE: Return JSON instead of redirecting
        // This lets your frontend 'handleEditSubmit' know the update worked
        res.status(200).json({ 
            success: true, 
            message: 'Coupon updated successfully' 
        });
    } catch (error) {
        // Send the error message in JSON format for the frontend alert
        res.status(400).json({ 
            success: false, 
            message: error.message 
        });
    }
};

/**
 * DELETE COUPON
 * Path: /admin/coupons/delete/:id
 */
export const deleteCoupon = async (req, res) => {
    try {
        await couponService.deleteCoupon(req.params.id);
        // Send JSON status 200
        res.status(200).json({ success: true, message: 'Deleted successfully' });
    } catch (error) {
        // Send JSON status 400
        res.status(400).json({ success: false, message: error.message });
    }
};

export const toggleStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        // Call the service layer
        await couponService.updateCouponStatus(id, status);

        res.status(200).json({ 
            success: true, 
            message: 'Status updated successfully' 
        });
    } catch (error) {
        // The service throws an error, the controller catches and responds
        res.status(400).json({ 
            success: false, 
            message: error.message 
        });
    }
};
/** 
 * API FOR CHECKOUT SIDE
 * Used by your Frontend/Customer side via AJAX (fetch/axios)
 */
export const applyCouponAPI = async (req, res) => {
    try {
        const { code, cartTotal } = req.body;
        const result = await couponService.validateCoupon(code, cartTotal);
        
        res.json({ 
            success: true, 
            ...result 
        });
    } catch (error) {
        res.json({ 
            success: false, 
            message: error.message 
        });
    }
};