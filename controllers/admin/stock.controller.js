import asyncHandler from '../../utils/asyncHandler.util.js';
import Product from '../../models/product.model.js';
import Variant from '../../models/variant.model.js';

// ─── GET /admin/stock ─────────────────────────────────────────────────────────
export const getStockPage = asyncHandler(async (req, res) => {
  const page   = Math.max(1, parseInt(req.query.page) || 1);
  const limit  = 15;
  const skip   = (page - 1) * limit;

  const { search = '', stockFilter = '', brand = '' } = req.query;

  // Build product filter
  const productFilter = { isDeleted: false };
  if (search) productFilter.name = { $regex: search.trim(), $options: 'i' };
  if (brand)  productFilter.brand = brand;

  const allProducts = await Product.find(productFilter)
    .populate('category', 'name')
    .sort({ createdAt: -1 })
    .lean();

  // Attach variants + compute stock for every product
  for (const p of allProducts) {
    const variants = await Variant.find({ product: p._id, isDeleted: false }).lean();
    p.variants   = variants;
    p.totalStock = variants.reduce((s, v) => s + v.stock, 0);
  }

  // Apply stock filter
  let filtered = allProducts;
  if (stockFilter === 'out') filtered = allProducts.filter(p => p.totalStock === 0);
  if (stockFilter === 'low') filtered = allProducts.filter(p => p.totalStock > 0 && p.totalStock <= 10);
  if (stockFilter === 'ok')  filtered = allProducts.filter(p => p.totalStock > 10);

  // Summary counts from the FULL filtered set (not just the current page)
  const summaryOutOfStock = allProducts.filter(p => p.totalStock === 0).length;
  const summaryLowStock   = allProducts.filter(p => p.totalStock > 0 && p.totalStock <= 10).length;
  const summaryInStock    = allProducts.filter(p => p.totalStock > 10).length;

  const total      = filtered.length;
  const totalPages = Math.ceil(total / limit);
  const paginated  = filtered.slice(skip, skip + limit);

  const brands = await Product.distinct('brand', { isDeleted: false });

  res.render('admin/stock', {
    layout:      'layouts/admin',
    path:        'stock',
    products:    paginated,
    total,
    currentPage: page,
    totalPages,
    search,
    stockFilter,
    brand,
    brands,
    // Summary counts from full dataset
    summaryTotal:      allProducts.length,
    summaryOutOfStock,
    summaryLowStock,
    summaryInStock,
  });
});

// ─── PATCH /admin/stock/:variantId ────────────────────────────────────────────
export const updateStock = asyncHandler(async (req, res) => {
  const { variantId } = req.params;
  const { stock } = req.body;

  const qty = parseInt(stock, 10);
  if (isNaN(qty) || qty < 0) {
    return res.status(400).json({ success: false, message: 'Stock must be a non-negative number.' });
  }

  const variant = await Variant.findByIdAndUpdate(variantId, { stock: qty }, { new: true });
  if (!variant) return res.status(404).json({ success: false, message: 'Variant not found.' });

  return res.json({ success: true, message: 'Stock updated.', stock: variant.stock });
});
