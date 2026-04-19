import asyncHandler from '../../utils/asyncHandler.util.js'
import Category from '../../models/category.model.js';

export const getCategory = asyncHandler(async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const search = req.query.search || ''; // Get search term from query
    const limit = 5;
    const skip = (page - 1) * limit;

    // Build the filter
    const filter = { isDeleted: false };
    if (search.trim()) {
        filter.name = { $regex: search.trim(), $options: 'i' }; // Case-insensitive search
    }

    const totalCategories = await Category.countDocuments(filter);
    const categories = await Category.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

    res.render('admin/categories', {
        categories,
       
        currentPage: page,
        totalPages: Math.ceil(totalCategories / limit),
        search, // Pass search back to the view
        layout: 'layouts/admin',
    });
});

// Add Category
export const addCategory = asyncHandler(async (req, res) => {
    const { name, description, offerValue, offerExpiry } = req.body;

    const exists = await Category.findOne({ 
        name: { $regex: `^${name.trim()}$`, $options: 'i' }, 
        isDeleted: false 
    });
    
    if (exists) return res.status(409).json({ success: false, message: 'Category already exists' });

    await Category.create({
        name: name.trim(),
        description: description?.trim(),
        offerPercent: Number(offerValue) || 0,
        offerExpiry: offerValue > 0 ? offerExpiry : null,
    });

    res.status(201).json({ success: true, message: 'Category added successfully' });
});

// Edit Category
export const editCategory = asyncHandler(async (req, res) => {
    const { id, name, description, offerValue, offerExpiry } = req.body;

    const exists = await Category.findOne({ 
        _id: { $ne: id }, 
        name: { $regex: `^${name.trim()}$`, $options: 'i' } 
    });
    
    if (exists) return res.status(409).json({ success: false, message: 'Category name already exists' });

    await Category.findByIdAndUpdate(id, {
        name: name.trim(),
        description: description?.trim(),
        offerPercent: Number(offerValue) || 0,
        offerExpiry: offerValue > 0 ? offerExpiry : null,
    });

    res.status(200).json({ success: true, message: 'Category updated successfully' });
});

// Toggle List/Unlist
export const toggleCategory = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const category = await Category.findById(id);
    if (!category) return res.status(404).json({ success: false, message: 'Not found' });

    category.isListed = !category.isListed;
    await category.save();

    res.json({ success: true, message: category.isListed ? 'Listed' : 'Unlisted' });
});

// Soft Delete
export const softDeleteCategory = asyncHandler(async (req, res) => {
    const { id } = req.params;
    await Category.findByIdAndUpdate(id, { isDeleted: true, isListed: false });
    res.json({ success: true, message: 'Category deleted successfully' });
});