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
        // Escape all regex special chars so names like "men's" work safely
        const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        filter.name   = { $regex: escaped, $options: 'i' };
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
    const lowerName   = trimmedName.toLowerCase();

    // Duplicate check — compare in JS to avoid regex special-char issues (e.g. apostrophes)
    const allActive = await Category.find({ isDeleted: false }).select('name').lean();
    const existing  = allActive.find(c => c.name.toLowerCase() === lowerName);
    if (existing) {
        return res.status(409).json({ success: false, message: 'Category already exists' });
    }

    // The unique index on `name` still applies to soft-deleted docs.
    // If a deleted doc has the same name, reuse its slot to avoid an 11000 error.
    const allDeleted = await Category.find({ isDeleted: true }).select('name _id').lean();
    const deletedSlot = allDeleted.find(c => c.name.toLowerCase() === lowerName);

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
    const lowerName   = trimmedName.toLowerCase();

    // Duplicate check — JS comparison, excludes self and deleted docs
    const allActive = await Category.find({ isDeleted: false }).select('name _id').lean();
    const duplicate = allActive.find(
        c => c._id.toString() !== id && c.name.toLowerCase() === lowerName
    );
    if (duplicate) {
        return res.status(409).json({ success: false, message: 'Another category with this name already exists' });
    }

    const category = await Category.findById(id);
    if (!category) {
        return res.status(404).json({ success: false, message: 'Category not found' });
    }

    // If a soft-deleted doc holds the same name, neutralise it to free the unique index slot
    const allDeleted = await Category.find({ isDeleted: true }).select('name _id').lean();
    const deletedConflict = allDeleted.find(
        c => c._id.toString() !== id && c.name.toLowerCase() === lowerName
    );
    if (deletedConflict) {
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
