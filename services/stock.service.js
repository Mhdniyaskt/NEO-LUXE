import Product from '../models/product.model.js';
import Variant from '../models/variant.model.js';
import mongoose from 'mongoose';
import { MESSAGES } from '../constants/messages.constant.js';

// ─── Get stock overview with filtering ───────────────────────────────────────
export const getStockOverviewService = async (filters = {}) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = '',
      stockStatus = '', // 'low', 'out', 'available'
      category = '',
      brand = '',
      sortBy = 'name'
    } = filters;

    const skip = (page - 1) * limit;

    // Build product filter
    const productFilter = { isDeleted: false };
    
    if (search && search.trim()) {
      productFilter.$or = [
        { name: { $regex: search.trim(), $options: 'i' } },
        { brand: { $regex: search.trim(), $options: 'i' } }
      ];
    }

    if (category) {
      productFilter.category = category;
    }

    if (brand) {
      productFilter.brand = brand;
    }

    // Get products with variants
    const products = await Product.find(productFilter)
      .populate('category', 'name')
      .lean();

    // Attach variants and calculate stock info
    const stockData = [];
    
    for (const product of products) {
      const variants = await Variant.find({
        product: product._id,
        isDeleted: false
      }).lean();

      const totalStock = variants.reduce((sum, v) => sum + v.stock, 0);
      const lowStockVariants = variants.filter(v => v.stock > 0 && v.stock <= 5);
      const outOfStockVariants = variants.filter(v => v.stock === 0);
      
      let stockStatusValue = 'available';
      if (totalStock === 0) {
        stockStatusValue = 'out';
      } else if (lowStockVariants.length > 0) {
        stockStatusValue = 'low';
      }

      // Filter by stock status if specified
      if (stockStatus && stockStatus !== stockStatusValue) {
        continue;
      }

      stockData.push({
        _id: product._id,
        name: product.name,
        brand: product.brand,
        category: product.category,
        isActive: product.isActive,
        variants: variants.map(v => ({
          _id: v._id,
          color: v.color,
          stock: v.stock,
          basePrice: v.basePrice,
          isActive: v.isActive
        })),
        totalStock,
        lowStockCount: lowStockVariants.length,
        outOfStockCount: outOfStockVariants.length,
        stockStatus: stockStatusValue,
        createdAt: product.createdAt
      });
    }

    // Sort data
    const sortOptions = {
      name: (a, b) => a.name.localeCompare(b.name),
      stock_low: (a, b) => a.totalStock - b.totalStock,
      stock_high: (a, b) => b.totalStock - a.totalStock,
      newest: (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
      oldest: (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
    };

    if (sortOptions[sortBy]) {
      stockData.sort(sortOptions[sortBy]);
    }

    // Pagination
    const total = stockData.length;
    const paginatedData = stockData.slice(skip, skip + limit);
    const totalPages = Math.ceil(total / limit);

    // Get filter options
    const brands = await Product.distinct('brand', { isDeleted: false });
    const categories = await Product.find({ isDeleted: false })
      .populate('category', 'name')
      .distinct('category');

    return {
      success: true,
      stock: paginatedData,
      pagination: {
        currentPage: page,
        totalPages,
        total,
        hasNext: page < totalPages,
        hasPrev: page > 1
      },
      filters: {
        brands,
        categories: categories.filter(c => c) // Remove null categories
      },
      summary: {
        totalProducts: stockData.length,
        lowStockProducts: stockData.filter(p => p.stockStatus === 'low').length,
        outOfStockProducts: stockData.filter(p => p.stockStatus === 'out').length,
        availableProducts: stockData.filter(p => p.stockStatus === 'available').length
      }
    };
  } catch (error) {
    console.error('Get stock overview service error:', error);
    return { success: false, message: MESSAGES.STOCK.FETCH_FAILED };
  }
};

// ─── Update variant stock ─────────────────────────────────────────────────────
export const updateVariantStockService = async (variantId, newStock, reason = '') => {
  try {
    if (newStock < 0) {
      return { success: false, message: MESSAGES.STOCK.NEGATIVE };
    }

    const variant = await Variant.findById(variantId);
    if (!variant || variant.isDeleted) {
      return { success: false, message: MESSAGES.STOCK.VARIANT_NOT_FOUND };
    }

    const oldStock = variant.stock;
    variant.stock = parseInt(newStock);
    
    // Add stock history entry (if you have a stock history model)
    // variant.stockHistory.push({
    //   oldStock,
    //   newStock: variant.stock,
    //   change: variant.stock - oldStock,
    //   reason,
    //   updatedAt: new Date()
    // });

    await variant.save();

    return {
      success: true,
      message: 'Stock updated successfully',
      variant: {
        _id: variant._id,
        stock: variant.stock,
        oldStock,
        change: variant.stock - oldStock
      }
    };
  } catch (error) {
    console.error('Update variant stock service error:', error);
    return { success: false, message: MESSAGES.STOCK.UPDATE_FAILED };
  }
};

// ─── Bulk update stock ────────────────────────────────────────────────────────
export const bulkUpdateStockService = async (updates) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    if (!Array.isArray(updates) || updates.length === 0) {
      throw new Error(MESSAGES.STOCK.UPDATES_REQUIRED);
    }

    const results = [];
    
    for (const update of updates) {
      const { variantId, stock, reason } = update;
      
      if (!variantId || stock === undefined) {
        results.push({
          variantId,
          success: false,
          message: MESSAGES.STOCK.VARIANT_ID_REQUIRED
        });
        continue;
      }

      if (stock < 0) {
        results.push({
          variantId,
          success: false,
          message: MESSAGES.STOCK.NEGATIVE
        });
        continue;
      }

      const variant = await Variant.findById(variantId).session(session);
      if (!variant || variant.isDeleted) {
        results.push({
          variantId,
          success: false,
          message: MESSAGES.STOCK.VARIANT_NOT_FOUND
        });
        continue;
      }

      const oldStock = variant.stock;
      variant.stock = parseInt(stock);
      await variant.save({ session });

      results.push({
        variantId,
        success: true,
        oldStock,
        newStock: variant.stock,
        change: variant.stock - oldStock
      });
    }

    await session.commitTransaction();

    const successCount = results.filter(r => r.success).length;
    const failureCount = results.length - successCount;

    return {
      success: true,
      message: `Bulk update completed. ${successCount} successful, ${failureCount} failed.`,
      results,
      summary: { successCount, failureCount }
    };
  } catch (error) {
    await session.abortTransaction();
    console.error('Bulk update stock service error:', error);
    return { success: false, message: error.message || MESSAGES.STOCK.BULK_UPDATE_FAILED };
  } finally {
    session.endSession();
  }
};

// ─── Get low stock alerts ─────────────────────────────────────────────────────
export const getLowStockAlertsService = async (threshold = 5) => {
  try {
    const lowStockVariants = await Variant.find({
      stock: { $gt: 0, $lte: threshold },
      isDeleted: false,
      isActive: true
    })
    .populate({
      path: 'product',
      select: 'name brand category',
      populate: { path: 'category', select: 'name' }
    })
    .lean();

    const alerts = lowStockVariants.map(variant => ({
      variantId: variant._id,
      productId: variant.product._id,
      productName: variant.product.name,
      brand: variant.product.brand,
      category: variant.product.category?.name,
      color: variant.color,
      currentStock: variant.stock,
      threshold,
      severity: variant.stock <= 2 ? 'critical' : 'warning'
    }));

    return {
      success: true,
      alerts,
      count: alerts.length,
      critical: alerts.filter(a => a.severity === 'critical').length,
      warning: alerts.filter(a => a.severity === 'warning').length
    };
  } catch (error) {
    console.error('Get low stock alerts service error:', error);
    return { success: false, message: MESSAGES.STOCK.ALERTS_FAILED };
  }
};

// ─── Get out of stock items ───────────────────────────────────────────────────
export const getOutOfStockService = async () => {
  try {
    const outOfStockVariants = await Variant.find({
      stock: 0,
      isDeleted: false,
      isActive: true
    })
    .populate({
      path: 'product',
      select: 'name brand category isActive',
      populate: { path: 'category', select: 'name' }
    })
    .lean();

    const outOfStock = outOfStockVariants.map(variant => ({
      variantId: variant._id,
      productId: variant.product._id,
      productName: variant.product.name,
      brand: variant.product.brand,
      category: variant.product.category?.name,
      color: variant.color,
      isProductActive: variant.product.isActive,
      lastUpdated: variant.updatedAt
    }));

    return {
      success: true,
      outOfStock,
      count: outOfStock.length
    };
  } catch (error) {
    console.error('Get out of stock service error:', error);
    return { success: false, message: MESSAGES.STOCK.OUT_OF_STOCK_FAILED };
  }
};

// ─── Get stock statistics ─────────────────────────────────────────────────────
export const getStockStatsService = async () => {
  try {
    const stats = await Variant.aggregate([
      { $match: { isDeleted: false } },
      {
        $group: {
          _id: null,
          totalVariants: { $sum: 1 },
          totalStock: { $sum: '$stock' },
          averageStock: { $avg: '$stock' },
          lowStock: {
            $sum: {
              $cond: [
                { $and: [{ $gt: ['$stock', 0] }, { $lte: ['$stock', 5] }] },
                1,
                0
              ]
            }
          },
          outOfStock: {
            $sum: {
              $cond: [{ $eq: ['$stock', 0] }, 1, 0]
            }
          },
          inStock: {
            $sum: {
              $cond: [{ $gt: ['$stock', 5] }, 1, 0]
            }
          }
        }
      }
    ]);

    const stockStats = stats[0] || {
      totalVariants: 0,
      totalStock: 0,
      averageStock: 0,
      lowStock: 0,
      outOfStock: 0,
      inStock: 0
    };

    // Get top products by stock
    const topStockProducts = await Product.aggregate([
      { $match: { isDeleted: false } },
      {
        $lookup: {
          from: 'variants',
          localField: '_id',
          foreignField: 'product',
          as: 'variants'
        }
      },
      {
        $project: {
          name: 1,
          brand: 1,
          totalStock: {
            $sum: {
              $map: {
                input: {
                  $filter: {
                    input: '$variants',
                    cond: { $eq: ['$$this.isDeleted', false] }
                  }
                },
                as: 'variant',
                in: '$$variant.stock'
              }
            }
          }
        }
      },
      { $sort: { totalStock: -1 } },
      { $limit: 5 }
    ]);

    return {
      success: true,
      stats: {
        ...stockStats,
        stockPercentages: {
          inStock: stockStats.totalVariants > 0 ? Math.round((stockStats.inStock / stockStats.totalVariants) * 100) : 0,
          lowStock: stockStats.totalVariants > 0 ? Math.round((stockStats.lowStock / stockStats.totalVariants) * 100) : 0,
          outOfStock: stockStats.totalVariants > 0 ? Math.round((stockStats.outOfStock / stockStats.totalVariants) * 100) : 0
        },
        topStockProducts
      }
    };
  } catch (error) {
    console.error('Get stock stats service error:', error);
    return { success: false, message: MESSAGES.STOCK.STATS_FAILED };
  }
};