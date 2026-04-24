import asyncHandler from '../../utils/asyncHandler.util.js';
import Product from '../../models/product.model.js';
import Variant from '../../models/variant.model.js';
import Category from '../../models/category.model.js';

export const getProducts = asyncHandler(async (req, res) => {
  const {
    search,
    category,
    brand,
    price,
    strap,
    sort = 'new',
    page = 1,
  } = req.query;
 
  const LIMIT = 8;
  const skip  = (Number(page) - 1) * LIMIT;
 
  // ── 1. Listed categories ───────────────────────────────────────
  const listedCategories = await Category.find({
    isListed:  true,
    isDeleted: false,
  }).select('_id name').lean();
 
  const listedIds = listedCategories.map((c) => c._id);
 
  // ── 2. Build product filter (only active + listed category) ───
  const productFilter = {
    isActive:  true,
    isDeleted: false,
    category:  category ? category : { $in: listedIds },
  };
 
  if (search)  productFilter.name  = { $regex: search.trim(), $options: 'i' };
  if (brand)   productFilter.brand = brand;
 
  // ── 3. Build variant filter ────────────────────────────────────
  const variantFilter = { isActive: true, isDeleted: false };
 
  if (price) {
    const [rawMin, rawMax] = price.split('-');
    const priceRange = {};
    if (rawMin) priceRange.$gte = Number(rawMin);
    if (rawMax) priceRange.$lte = Number(rawMax);
    if (Object.keys(priceRange).length) variantFilter.finalPrice = priceRange;
  }
 
  if (strap) variantFilter.strapType = { $regex: strap, $options: 'i' };
 
  // ── 4. Fetch products + cheapest qualifying variant ────────────
  //    Use Promise.all instead of sequential awaits for performance
  const rawProducts = await Product.find(productFilter)
    .populate({ path: 'category', select: 'name', match: { isListed: true } })
    .lean();
 
  const withVariants = await Promise.all(
    rawProducts.map(async (product) => {
      const variant = await Variant.findOne({
        ...variantFilter,
        product: product._id,
      })
        .sort({ finalPrice: 1 })
        .lean();
 
      if (!variant) return null; // product has no active/matching variant → hide it
      return { ...product, variant };
    })
  );
 
  // Drop nulls (no variant matched) and products whose category didn't populate
  // (populate returns null when match fails → category = null means unlisted)
  const finalProducts = withVariants.filter(
    (p) => p !== null && p.category !== null
  );
 
  // ── 5. Sort in JS (after price-filter already narrowed the set) ─
  const sorters = {
    lowToHigh: (a, b) => a.variant.finalPrice - b.variant.finalPrice,
    highToLow: (a, b) => b.variant.finalPrice - a.variant.finalPrice,
    az:        (a, b) => a.name.localeCompare(b.name),
    za:        (a, b) => b.name.localeCompare(a.name),
    popular:   (a, b) => (b.soldCount || 0) - (a.soldCount || 0),
    new:       (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
  };
  finalProducts.sort(sorters[sort] || sorters.new);
 
  // ── 6. Pagination ──────────────────────────────────────────────
  const totalProducts = finalProducts.length;
  const totalPages    = Math.ceil(totalProducts / LIMIT);
  const paginated     = finalProducts.slice(skip, skip + LIMIT);
 
  // ── 7. Brand list for optional sidebar filter ──────────────────
  const brands = await Product.distinct('brand', {
    isActive:  true,
    isDeleted: false,
    brand:     { $exists: true, $ne: '' },
  });
 
  // ── 8. Render ──────────────────────────────────────────────────
  res.render('user/shop-page', {
    layout:       'layouts/user',
    products:     paginated,
    categories:   listedCategories,
    brands,                          // ← new: passed to EJS for brand filter
    currentPage:  Number(page),
    totalPages,
    totalProducts,                   // ← new: used in "Showing X of Y" line
    query:        req.query,
  });
});




export const getProductDetails = asyncHandler(async (req, res) => {
  const { id }        = req.params;
  const { variantId } = req.query;

  // ── 1. Fetch product — redirect if blocked/unlisted ──────────────
  const product = await Product.findOne({
    _id:       id,
    isActive:  true,
    isDeleted: false,
  }).populate({
    path:   'category',
    select: 'name isListed', // Removed offer fields
    match:  { isListed: true, isDeleted: false },
  });

  // No product OR category is unlisted → back to shop
  if (!product || !product.category) {
    return res.redirect('/shop');
  }

  // ── 2. Fetch active variants ─────────────────────────────────────
  let variants = await Variant.find({
    product:   product._id,
    isActive:  true,
    isDeleted: false,
  })
    .sort({ createdAt: -1 })
    .lean();

  // All variants removed → 404
  if (!variants.length) {
    return res.status(404).render('user/404');
  }

  // Attach default pricing (No Offers)
  variants = variants.map((v) => {
    return { 
      ...v, 
      finalPrice: v.basePrice, // Final price is now just base price
      appliedOffer: 0          // Zero offer applied
    };
  });

  // ── 3. Resolve default variant ───────────────────────────────────
  const defaultVariant = variantId
    ? (variants.find((v) => v._id.toString() === variantId) || variants[0])
    : variants[0];

  // Requested variantId not found or inactive → redirect without query
  if (variantId && !variants.find((v) => v._id.toString() === variantId)) {
    return res.redirect(`/shop/${id}`);
  }

  // ── 4. Related products (same category, active, with a variant) ──
  const relatedRaw = await Product.find({
    category:  product.category._id,
    _id:       { $ne: id },
    isActive:  true,
    isDeleted: false,
  })
    .limit(4)
    .lean();

  const recommendations = await Promise.all(
    relatedRaw.map(async (p) => {
      const variant = await Variant.findOne({
        product:   p._id,
        isActive:  true,
        isDeleted: false,
      }).lean();

      if (!variant) return null;

      return {
        ...p,
        category: product.category, 
        variant:  { 
          ...variant, 
          finalPrice: variant.basePrice, 
          appliedOffer: 0 
        },
      };
    })
  );

  // ── 5. Render ─────────────────────────────────────────────────────
  res.render('user/product-details', {
    layout:          'layouts/user',
    product,
    variants,
    defaultVariant,
    recommendations: recommendations.filter(Boolean),
  });
});