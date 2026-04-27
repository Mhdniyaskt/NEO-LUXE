import asyncHandler from '../../utils/asyncHandler.util.js';
import Category from '../../models/category.model.js';

// ── GET /admin/categories ────────────────────────────────────────────────────
export const getCategory = asyncHandler(async (req, res) => {
    const page   = parseInt(req.query.page) || 1;
    const search = req.query.search || '';
    const limit  = 5;
    const skip   = (page - 1) * limit;

    const filter = { isDeleted: false };
    if (search.trim()) {
        // Use $text or simple contains — avoid $regex with user input
        filter.name = { $regex: search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    }

    const totalCategories = await Category.countDocuments(filter);
    const categories = await Category.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

    res.render('admin/categories', {
        categories,
        currentPage: page,
        totalPages:  Math.ceil(totalCategories / limit),
        search,
        layout: 'layouts/admin',
    });
});

// ── POST /admin/add-category ─────────────────────────────────────────────────
export const addCategory = asyncHandler(async (req, res) => {
    const { name, description } = req.body;

    if (!name || name.trim().length < 3) {
        return res.status(400).json({ success: false, message: 'Category name must be at least 3 characters' });
    }
    if (!description || description.trim().length < 10) {
        return res.status(400).json({ success: false, message: 'Please provide a description (min 10 chars)' });
    }

    const trimmedName = name.trim();
    const trimmedDesc = description.trim();

    // Fetch all non-deleted categories and compare in JS to avoid regex issues
    const allCategories = await Category.find({}).lean();
    const existing = allCategories.find(
        c => c.name.toLowerCase() === trimmedName.toLowerCase()
    );

    if (existing) {
        if (!existing.isDeleted) {
            return res.status(409).json({ success: false, message: 'Category already exists' });
        }
        // Restore soft-deleted category
        await Category.findByIdAndUpdate(existing._id, {
            isDeleted:   false,
            name:        trimmedName,
            description: trimmedDesc,
        });
        return res.status(200).json({ success: true, message: 'Category restored successfully' });
    }

    try {
        await Category.create({ name: trimmedName, description: trimmedDesc });
    } catch (err) {
        if (err.code === 11000) {
            return res.status(409).json({ success: false, message: 'Category already exists' });
        }
        throw err;
    }

    res.status(201).json({ success: true, message: 'Category added successfully' });
});

// ── PUT /admin/edit-category ─────────────────────────────────────────────────
export const editCategory = asyncHandler(async (req, res) => {
    const { id, name, description } = req.body;

    if (!name || name.trim().length < 3) {
        return res.status(400).json({ success: false, message: 'Category name must be at least 3 characters' });
    }
    if (!description || description.trim().length < 10) {
        return res.status(400).json({ success: false, message: 'Description must be at least 10 characters' });
    }

    const trimmedName = name.trim();
    const trimmedDesc = description.trim();

    // Compare in JS — no regex, no special character issues
    const allCategories = await Category.find({ isDeleted: false }).lean();
    const duplicate = allCategories.find(
        c => c._id.toString() !== id &&
             c.name.toLowerCase() === trimmedName.toLowerCase()
    );

    if (duplicate) {
        return res.status(409).json({ success: false, message: 'Another category with this name already exists' });
    }

    // findById + save() avoids unique-index conflict on the same document
    const category = await Category.findById(id);
    if (!category) {
        return res.status(404).json({ success: false, message: 'Category not found' });
    }

    category.name        = trimmedName;
    category.description = trimmedDesc;

    try {
        await category.save();
    } catch (err) {
        if (err.code === 11000) {
            return res.status(409).json({ success: false, message: 'Another category with this name already exists' });
        }
        throw err;
    }

    res.status(200).json({ success: true, message: 'Category updated successfully' });
});

// ── PATCH /admin/toggle-category/:id ────────────────────────────────────────
export const toggleCategory = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const category = await Category.findById(id);
    if (!category) return res.status(404).json({ success: false, message: 'Not found' });

    category.isListed = !category.isListed;
    await category.save();

    res.json({ success: true, message: category.isListed ? 'Listed' : 'Unlisted' });
});

// ── DELETE /admin/delete-category/:id ───────────────────────────────────────
export const softDeleteCategory = asyncHandler(async (req, res) => {
    const { id } = req.params;
    await Category.findByIdAndUpdate(id, { isDeleted: true, isListed: false });
    res.json({ success: true, message: 'Category deleted successfully' });
});
