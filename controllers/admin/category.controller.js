import asyncHandler from '../../utils/asyncHandler.util.js'
import Category from '../../models/category.model.js';

export const getCategory = asyncHandler(async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const search = req.query.search || ''; // Get search term from query
    const limit = 5;
    const skip = (page - 1) * limit;

   
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


export const addCategory = asyncHandler(async (req, res) => {
    const { name, description } = req.body;
    const trimmedName = name.trim();
     

    if (!name || name.trim().length < 3) {
        return res.status(400).json({ success: false, message: 'Category name must be at least 3 characters' });
    }

    // NEW: Description Validation
    if (!description || description.trim().length < 10) {
        return res.status(400).json({ success: false, message: 'Please provide a description (min 10 chars)' });
    }
    // 1. Check for ANY document with this name (deleted or not)
    const existingCategory = await Category.findOne({ 
        name: { $regex: `^${trimmedName}$`, $options: 'i' } 
    });

    if (existingCategory) {
        // If it exists and isn't deleted, throw the 409
        if (!existingCategory.isDeleted) {
            return res.status(409).json({ success: false, message: 'Category already exists' });
        }

        // If it exists but IS deleted, "restore" it with new data
        existingCategory.isDeleted = false;
        existingCategory.description = description?.trim();
        
        
        await existingCategory.save();
        return res.status(200).json({ success: true, message: 'Category restored successfully' });
    }

    // 2. If it doesn't exist at all, create it
    await Category.create({
        name: trimmedName,
        description: description?.trim(),
    
    });

    res.status(201).json({ success: true, message: 'Category added successfully' });
});

export const editCategory = asyncHandler(async (req, res) => {
    const { id, name, description } = req.body;

    // --- 1. Basic Validation ---
    if (!name || name.trim().length < 3) {
        return res.status(400).json({ success: false, message: 'Category name must be at least 3 characters' });
    }

    if (!description || description.trim().length < 10) {
        return res.status(400).json({ success: false, message: 'Description must be at least 10 characters' });
    }

    const trimmedName = name.trim();
    const trimmedDesc = description.trim();
    

   

    // --- 2. Duplicate Check (Excluding Current Category) ---
    const exists = await Category.findOne({ 
        _id: { $ne: id }, 
        name: { $regex: `^${trimmedName}$`, $options: 'i' },
        isDeleted: false // Only conflict with active categories
    });
    
    if (exists) {
        return res.status(409).json({ success: false, message: 'Another category with this name already exists' });
    }

    // --- 3. Update Database ---
    const updatedCategory = await Category.findByIdAndUpdate(
        id, 
        {
            name: trimmedName,
            description: trimmedDesc,
          
        },
        { new: true } // Returns the modified document
    );

    if (!updatedCategory) {
        return res.status(404).json({ success: false, message: 'Category not found' });
    }

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