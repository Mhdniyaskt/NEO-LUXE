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
    sort = 'az',   // ← was missing from destructuring — caused sort to always be undefined
    page = 1,
  } = req.query;

  const LIMIT = 8;
  const skip = (Number(page) - 1) * LIMIT;

  // 1. Listed categories only
  const listedCategories = await Category.find({
    isListed: true,
    isDeleted: false,
  })
    .select('_id name')
    .lean();

  const listedIds = listedCategories.map((c) => c._id);

  // 2. Build product filter
  const productFilter = {
    isActive: true,
    isDeleted: false,
    category: category ? category : { $in: listedIds },
  };

  if (search) {
    productFilter.name = { $regex: search.trim(), $options: 'i' };
  }

  if (brand) {
    productFilter.brand = { $regex: `^${brand.trim()}$`, $options: 'i' };
  }

  // 3. Variant filter — price only (strap removed)
  const variantFilter = { isActive: true, isDeleted: false };

  if (price) {
    const [rawMin, rawMax] = price.split('-');
    const priceRange = {};
    if (rawMin !== '' && rawMin !== undefined) priceRange.$gte = Number(rawMin);
    if (rawMax !== '' && rawMax !== undefined) priceRange.$lte = Number(rawMax);
    if (Object.keys(priceRange).length) variantFilter.regularPrice = priceRange;
  }

  // 4. Fetch matching products
  const rawProducts = await Product.find(productFilter)
    .populate({ path: 'category', select: 'name', match: { isListed: true } })
    .lean();

  // 5. Attach cheapest valid variant to each product
  const withVariants = await Promise.all(
    rawProducts.map(async (product) => {
      if (!product.category) return null;

      const variant = await Variant.findOne({
        ...variantFilter,
        product: product._id,
      })
        .sort({ regularPrice: 1 })
        .lean();

      if (!variant) return null;

      variant.finalPrice   = variant.basePrice ?? variant.regularPrice ?? 0;
      variant.salePrice    = variant.basePrice ?? 0;
      variant.regularPrice = variant.regularPrice ?? 0;
      variant.appliedOffer =
        variant.regularPrice && variant.basePrice && variant.regularPrice > variant.basePrice
          ? Math.round((variant.regularPrice - variant.basePrice) / variant.regularPrice * 100)
          : 0;

      variant.displayImage =
        variant.images && variant.images.length > 0
          ? variant.images[0].url
          : null;

      return { ...product, variant };
    })
  );

  const finalProducts = withVariants.filter(Boolean);

  // 6. Sort — 4 options only (no strap / new / popular)
  const sorters = {
    lowToHigh: (a, b) => a.variant.finalPrice - b.variant.finalPrice,
    highToLow: (a, b) => b.variant.finalPrice - a.variant.finalPrice,
    az:        (a, b) => a.name.localeCompare(b.name),
    za:        (a, b) => b.name.localeCompare(a.name),
  };

  finalProducts.sort(sorters[sort] || sorters.az);

  // 7. Paginate after sort
  const totalProducts = finalProducts.length;
  const totalPages    = Math.ceil(totalProducts / LIMIT) || 1;
  const paginated     = finalProducts.slice(skip, skip + LIMIT);

  // 8. Brand list for sidebar
  const brands = await Product.distinct('brand', {
    isActive:  true,
    isDeleted: false,
    category:  { $in: listedIds },
    brand:     { $exists: true, $ne: '' },
  });
  brands.sort((a, b) => a.localeCompare(b));

  // 9. Render
  res.render('user/shop-page', {
    layout: 'layouts/user',
    products:    paginated,
    categories:  listedCategories,
    brands,
    currentPage: Number(page),
    totalPages,
    totalProducts,
    query: req.query,
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
          finalPrice:   variant.basePrice, 
          regularPrice: variant.regularPrice,
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