import asyncHandler from '../../utils/asyncHandler.util.js';
import Product from '../../models/product.model.js';
import Variant from '../../models/variant.model.js';
import Category from '../../models/category.model.js';
import { calculateOfferPrice } from '../../utils/offerPrice.util.js';

export const getProducts = asyncHandler(async (req, res) => {
  const {
    search,
    category,
    brand,
    price,
    sort = 'az',
    page = 1,
  } = req.query;

  const LIMIT = 8;
  const skip = (Number(page) - 1) * LIMIT;

  // 1. Listed categories only
  const listedCategories = await Category.find({
    isListed: true,
    isDeleted: false,
  })
    .select('_id name offerPercentage offerExpiryDate')
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

  // 3. Variant filter — price only
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
    .populate({ path: 'category', select: 'name offerPercentage offerExpiryDate', match: { isListed: true } })
    .lean();

  // 5. Attach best variant with offer pricing
  const withVariants = await Promise.all(
    rawProducts.map(async (product) => {
      if (!product.category) return null;

      let variant = await Variant.findOne({
        ...variantFilter,
        product: product._id,
        stock: { $gt: 0 },
      })
        .sort({ regularPrice: 1 })
        .lean();

      if (!variant) {
        variant = await Variant.findOne({
          ...variantFilter,
          product: product._id,
        })
          .sort({ regularPrice: 1 })
          .lean();
      }

      if (!variant) return null;

      // Apply offer pricing
      const offerResult = calculateOfferPrice(variant, product.category, product);
      variant.finalPrice      = offerResult.finalPrice;
      variant.salePrice       = offerResult.salePrice;
      variant.regularPrice    = offerResult.regularPrice;
      variant.appliedOffer    = offerResult.offerPercentage;  // 0 if no active offer
      variant.offerSource     = offerResult.offerSource;
      variant.displayImage    = variant.images && variant.images.length > 0
          ? variant.images[0].url
          : null;

      return { ...product, variant };
    })
  );

  const finalProducts = withVariants.filter(Boolean);

  // 6. Sort
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

  const product = await Product.findOne({
    _id:       id,
    isDeleted: false,
  }).populate({
    path:   'category',
    select: 'name isListed isDeleted offerPercentage offerExpiryDate',
  });

  if (!product) {
    return res.redirect('/shop');
  }

  let unavailableReason = null;

  if (!product.isActive) {
    unavailableReason = 'This product has been unlisted by the store.';
  } else if (!product.category || product.category.isDeleted) {
    unavailableReason = 'This product\'s category is no longer available.';
  } else if (product.category && !product.category.isListed) {
    unavailableReason = `The category "${product.category.name}" is currently unlisted.`;
  }

  if (unavailableReason) {
    return res.status(410).render('user/product-unavailable', {
      layout:  'layouts/user',
      product,
      reason:  unavailableReason,
    });
  }

  const anyVariant = await Variant.exists({ product: product._id, isDeleted: false });
  if (!anyVariant) {
    return res.status(410).render('user/product-unavailable', {
      layout:  'layouts/user',
      product,
      reason:  'This product has no variants available.',
    });
  }

  let variants = await Variant.find({
    product:   product._id,
    isDeleted: false,
  })
    .sort({ isActive: -1, createdAt: -1 })
    .lean();

  // Apply offer pricing to each variant
  variants = variants.map((v) => {
    const offerResult = calculateOfferPrice(v, product.category, product);
    return {
      ...v,
      finalPrice:      offerResult.finalPrice,
      salePrice:       offerResult.salePrice,
      appliedOffer:    offerResult.offerPercentage,  // 0 if no active offer
      offerSource:     offerResult.offerSource,
      regularPrice:    offerResult.regularPrice,
      productOffer:    offerResult.productOffer,
      categoryOffer:   offerResult.categoryOffer,
    };
  });

  // Resolve default variant
  let defaultVariant = null;
  if (variantId) {
    defaultVariant = variants.find((v) => v._id.toString() === variantId);
    if (!defaultVariant) return res.redirect(`/shop/${id}`);
  } else {
    defaultVariant =
      variants.find((v) => v.isActive && v.stock > 0) ||
      variants.find((v) => v.isActive) ||
      variants[0];
  }

  // Related products with offer pricing
  const relatedRaw = await Product.find({
    category:  product.category._id,
    _id:       { $ne: id },
    isActive:  true,
    isDeleted: false,
  })
    .populate({ path: 'category', select: 'name offerPercentage offerExpiryDate' })
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

      const offerResult = calculateOfferPrice(variant, p.category, p);
      return {
        ...p,
        variant: {
          ...variant,
          finalPrice:   offerResult.finalPrice,
          salePrice:    offerResult.salePrice,
          regularPrice: offerResult.regularPrice,
          appliedOffer: offerResult.offerPercentage,
          offerSource:  offerResult.offerSource,
        },
      };
    })
  );

  res.render('user/product-details', {
    layout:          'layouts/user',
    product,
    variants,
    defaultVariant,
    recommendations: recommendations.filter(Boolean),
  });
});