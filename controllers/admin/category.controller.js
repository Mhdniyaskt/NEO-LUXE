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

    // Duplicate check — only against active (non-deleted) categories
    const existing = await Category.findOne({
        name:      { $regex: `^${trimmedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
        isDeleted: false,
    }).lean();

    if (existing) {
        return res.status(409).json({ success: false, message: 'Category already exists' });
    }

    // The unique index on `name` still applies to soft-deleted docs in the collection.
    // If a deleted doc has the same name, reuse its slot instead of inserting a new one.
    const deletedSlot = await Category.findOne({
        name:      { $regex: `^${trimmedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
        isDeleted: true,
    }).lean();

    if (deletedSlot) {
        await Category.findByIdAndUpdate(deletedSlot._id, {
            name:        trimmedName,
            description: trimmedDesc,
            isDeleted:   false,
            isListed:    true,
        });
    } else {
        await Category.create({ name: trimmedName, description: trimmedDesc });
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

    // Duplicate check — only against active (non-deleted) categories, excluding self
    const duplicate = await Category.findOne({
        _id:       { $ne: id },
        name:      { $regex: `^${trimmedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
        isDeleted: false,
    }).lean();

    if (duplicate) {
        return res.status(409).json({ success: false, message: 'Another category with this name already exists' });
    }

    const category = await Category.findById(id);
    if (!category) {
        return res.status(404).json({ success: false, message: 'Category not found' });
    }

    // The unique index on `name` applies to ALL documents including soft-deleted ones.
    // If a deleted doc has the same name, free up the index slot before saving.
    const deletedConflict = await Category.findOne({
        _id:       { $ne: id },
        name:      { $regex: `^${trimmedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
        isDeleted: true,
    }).lean();

    if (deletedConflict) {
        // Neutralise the deleted doc's name so the unique index no longer blocks us
        await Category.findByIdAndUpdate(deletedConflict._id, {
            name: `__deleted_${deletedConflict._id}`,
        });
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
