import Category from '../models/category.model.js';
import Product from '../models/product.model.js';
import { MESSAGES } from '../constants/messages.constant.js';

// ─── Get all categories with filtering ───────────────────────────────────────
export const getCategoriesService = async (filters = {}) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = '',
      isListed = null,
      isAdmin = false
    } = filters;

    const skip = (page - 1) * limit;

    // Build filter query
    const filter = {};
    
    if (!isAdmin && isListed !== null) {
      filter.isListed = isListed;
    } else if (!isAdmin) {
      filter.isListed = true; // Default for non-admin users
    }

    if (search && search.trim()) {
      filter.$or = [
        { name: { $regex: search.trim(), $options: 'i' } },
        { description: { $regex: search.trim(), $options: 'i' } }
      ];
    }

    // Get categories with pagination
    const categories = await Category.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    // Add product count for each category
    for (let category of categories) {
      const productCount = await Product.countDocuments({
        category: category._id,
        isDeleted: false,
        ...(isAdmin ? {} : { isActive: true })
      });
      category.productCount = productCount;
    }

    const total = await Category.countDocuments(filter);
    const totalPages = Math.ceil(total / limit);

    return {
      success: true,
      categories,
      pagination: {
        currentPage: page,
        totalPages,
        total,
        hasNext: page < totalPages,
        hasPrev: page > 1
      }
    };
  } catch (error) {
    console.error('Get categories service error:', error);
    return { success: false, message: MESSAGES.CATEGORY.FETCH_FAILED };
  }
};

// ─── Get single category by ID ───────────────────────────────────────────────
export const getCategoryByIdService = async (categoryId, isAdmin = false) => {
  try {
    const category = await Category.findById(categoryId).lean();
    
    if (!category) {
      return { success: false, message: MESSAGES.CATEGORY.NOT_FOUND };
    }

    if (!isAdmin && !category.isListed) {
      return { success: false, message: MESSAGES.CATEGORY.NOT_AVAILABLE };
    }

    // Get product count
    const productCount = await Product.countDocuments({
      category: categoryId,
      isDeleted: false,
      ...(isAdmin ? {} : { isActive: true })
    });

    category.productCount = productCount;

    return { success: true, category };
  } catch (error) {
    console.error('Get category by ID service error:', error);
    return { success: false, message: MESSAGES.CATEGORY.FETCH_ONE_FAILED };
  }
};

// ─── Create new category ──────────────────────────────────────────────────────
export const createCategoryService = async (categoryData) => {
  try {
    const { name, description, isListed = true } = categoryData;

    // Validation
    if (!name || !name.trim()) {
      return { success: false, message: MESSAGES.CATEGORY.NAME_REQUIRED };
    }

    // Check if category name already exists
    const existingCategory = await Category.findOne({
      name: { $regex: `^${name.trim()}$`, $options: 'i' }
    });

    if (existingCategory) {
      return { success: false, message: MESSAGES.CATEGORY.ALREADY_EXISTS };
    }

    // Create category
    const category = new Category({
      name: name.trim(),
      description: description?.trim() || '',
      isListed
    });

    await category.save();

    return {
      success: true,
      message: 'Category created successfully',
      category
    };
  } catch (error) {
    console.error('Create category service error:', error);
    return { success: false, message: MESSAGES.CATEGORY.CREATE_FAILED };
  }
};

// ─── Update category ──────────────────────────────────────────────────────────
export const updateCategoryService = async (categoryId, updateData) => {
  try {
    const category = await Category.findById(categoryId);
    if (!category) {
      return { success: false, message: MESSAGES.CATEGORY.NOT_FOUND };
    }

    const { name, description, isListed } = updateData;

    // Validate name if provided
    if (name !== undefined) {
      if (!name || !name.trim()) {
        return { success: false, message: MESSAGES.CATEGORY.NAME_EMPTY };
      }

      // Check if name already exists (excluding current category)
      const existingCategory = await Category.findOne({
        name: { $regex: `^${name.trim()}$`, $options: 'i' },
        _id: { $ne: categoryId }
      });

      if (existingCategory) {
        return { success: false, message: MESSAGES.CATEGORY.ALREADY_EXISTS };
      }
    }

    // Update fields
    const updates = {};
    if (name !== undefined) updates.name = name.trim();
    if (description !== undefined) updates.description = description?.trim() || '';
    if (isListed !== undefined) updates.isListed = isListed;

    const updatedCategory = await Category.findByIdAndUpdate(
      categoryId,
      updates,
      { new: true, runValidators: true }
    );

    return {
      success: true,
      message: 'Category updated successfully',
      category: updatedCategory
    };
  } catch (error) {
    console.error('Update category service error:', error);
    return { success: false, message: MESSAGES.CATEGORY.UPDATE_FAILED };
  }
};

// ─── Delete category ──────────────────────────────────────────────────────────
export const deleteCategoryService = async (categoryId) => {
  try {
    const category = await Category.findById(categoryId);
    if (!category) {
      return { success: false, message: MESSAGES.CATEGORY.NOT_FOUND };
    }

    // Check if category has products
    const productCount = await Product.countDocuments({
      category: categoryId,
      isDeleted: false
    });

    if (productCount > 0) {
      return { 
        success: false, 
        message: `Cannot delete category. It has ${productCount} products. Please move or delete products first.` 
      };
    }

    await Category.findByIdAndDelete(categoryId);

    return { success: true, message: MESSAGES.CATEGORY.DELETE_SUCCESS };
  } catch (error) {
    console.error('Delete category service error:', error);
    return { success: false, message: MESSAGES.CATEGORY.DELETE_FAILED };
  }
};

// ─── Toggle category status ───────────────────────────────────────────────────
export const toggleCategoryStatusService = async (categoryId) => {
  try {
    const category = await Category.findById(categoryId);
    if (!category) {
      return { success: false, message: MESSAGES.CATEGORY.NOT_FOUND };
    }

    const newStatus = !category.isListed;
    
    // If unlisting category, also unlist all products in this category
    if (!newStatus) {
      await Product.updateMany(
        { category: categoryId },
        { isActive: false }
      );
    }

    category.isListed = newStatus;
    await category.save();

    return {
      success: true,
      message: `Category ${newStatus ? 'listed' : 'unlisted'} successfully`,
      isListed: newStatus
    };
  } catch (error) {
    console.error('Toggle category status service error:', error);
    return { success: false, message: MESSAGES.CATEGORY.STATUS_FAILED };
  }
};

// ─── Get category statistics ──────────────────────────────────────────────────
export const getCategoryStatsService = async () => {
  try {
    const stats = await Category.aggregate([
      {
        $lookup: {
          from: 'products',
          localField: '_id',
          foreignField: 'category',
          as: 'products'
        }
      },
      {
        $project: {
          name: 1,
          isListed: 1,
          productCount: {
            $size: {
              $filter: {
                input: '$products',
                cond: { $eq: ['$$this.isDeleted', false] }
              }
            }
          },
          activeProductCount: {
            $size: {
              $filter: {
                input: '$products',
                cond: {
                  $and: [
                    { $eq: ['$$this.isDeleted', false] },
                    { $eq: ['$$this.isActive', true] }
                  ]
                }
              }
            }
          }
        }
      },
      {
        $sort: { productCount: -1 }
      }
    ]);

    const totalCategories = await Category.countDocuments();
    const listedCategories = await Category.countDocuments({ isListed: true });

    return {
      success: true,
      stats: {
        totalCategories,
        listedCategories,
        unlistedCategories: totalCategories - listedCategories,
        categoryDetails: stats
      }
    };
  } catch (error) {
    console.error('Get category stats service error:', error);
    return { success: false, message: MESSAGES.CATEGORY.STATS_FAILED };
  }
};

// ─── Get categories for dropdown/select ───────────────────────────────────────
export const getCategoriesForSelectService = async (isAdmin = false) => {
  try {
    const filter = isAdmin ? {} : { isListed: true };
    
    const categories = await Category.find(filter)
      .select('_id name')
      .sort({ name: 1 })
      .lean();

    return { success: true, categories };
  } catch (error) {
    console.error('Get categories for select service error:', error);
    return { success: false, message: MESSAGES.CATEGORY.FETCH_FAILED };
  }
};