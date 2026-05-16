import Product from '../models/product.model.js';
import Variant from '../models/variant.model.js';
import Category from '../models/category.model.js';
import cloudinary from '../config/cloudinary.config.js';
import { MESSAGES } from '../constants/messages.constant.js';

// ─── Get products with filtering, pagination and search ──────────────────────
export const getProductsService = async (filters = {}) => {
  try {
    const {
      page = 1,
      limit = 12,
      search = '',
      category = '',
      brand = '',
      minPrice = 0,
      maxPrice = 999999,
      sortBy = 'newest',
      isAdmin = false
    } = filters;

    const skip = (page - 1) * limit;
    
    // Build filter query
    const filter = {};
    
    if (!isAdmin) {
      filter.isDeleted = false;
      filter.isActive = true;
    } else {
      filter.isDeleted = false;
    }

    if (search && search.trim()) {
      filter.$or = [
        { name: { $regex: search.trim(), $options: 'i' } },
        { brand: { $regex: search.trim(), $options: 'i' } },
        { description: { $regex: search.trim(), $options: 'i' } }
      ];
    }

    if (category) {
      filter.category = category;
    }

    if (brand) {
      filter.brand = brand;
    }

    // Sort options
    const sortOptions = {
      newest: { createdAt: -1 },
      oldest: { createdAt: 1 },
      name_asc: { name: 1 },
      name_desc: { name: -1 },
      price_low: {},  // Will be handled after variant aggregation
      price_high: {}  // Will be handled after variant aggregation
    };

    let sortQuery = sortOptions[sortBy] || { createdAt: -1 };

    // Get products
    const products = await Product.find(filter)
      .populate('category', 'name isListed')
      .sort(sortQuery)
      .skip(skip)
      .limit(limit)
      .lean();

    // Attach variants and calculate pricing
    for (let product of products) {
      const variantFilter = { product: product._id };
      if (!isAdmin) {
        variantFilter.isDeleted = false;
        variantFilter.isActive = true;
      } else {
        variantFilter.isDeleted = false;
      }

      const variants = await Variant.find(variantFilter).lean();
      product.variants = variants;

      if (variants.length > 0) {
        const prices = variants.map(v => v.finalPrice ?? v.basePrice);
        product.minPrice = Math.min(...prices);
        product.maxPrice = Math.max(...prices);
        product.totalStock = variants.reduce((sum, v) => sum + v.stock, 0);
        product.bestOffer = Math.max(...variants.map(v => v.offerPercentage || 0));
      } else {
        product.minPrice = 0;
        product.maxPrice = 0;
        product.totalStock = 0;
        product.bestOffer = 0;
      }

      // Filter by price range
      if (product.minPrice < minPrice || product.minPrice > maxPrice) {
        continue;
      }
    }

    // Filter products by price range
    const filteredProducts = products.filter(p => 
      p.minPrice >= minPrice && p.minPrice <= maxPrice
    );

    // Sort by price if needed
    if (sortBy === 'price_low') {
      filteredProducts.sort((a, b) => a.minPrice - b.minPrice);
    } else if (sortBy === 'price_high') {
      filteredProducts.sort((a, b) => b.minPrice - a.minPrice);
    }

    // Get total count for pagination
    const totalProducts = await Product.countDocuments(filter);
    const totalPages = Math.ceil(totalProducts / limit);

    // Get available brands and categories for filters
    const brands = await Product.distinct('brand', { isDeleted: false });
    const categories = await Category.find({ isListed: true }, 'name').lean();

    return {
      success: true,
      products: filteredProducts,
      pagination: {
        currentPage: page,
        totalPages,
        totalProducts,
        hasNext: page < totalPages,
        hasPrev: page > 1
      },
      filters: {
        brands,
        categories
      }
    };
  } catch (error) {
    console.error('Get products service error:', error);
    return { success: false, message: MESSAGES.PRODUCT.FETCH_FAILED };
  }
};

// ─── Get single product with variants ────────────────────────────────────────
export const getProductByIdService = async (productId, isAdmin = false) => {
  try {
    const filter = { _id: productId };
    if (!isAdmin) {
      filter.isDeleted = false;
      filter.isActive = true;
    }

    const product = await Product.findOne(filter)
      .populate('category', 'name isListed')
      .lean();

    if (!product) {
      return { success: false, message: MESSAGES.PRODUCT.NOT_FOUND };
    }

    // Check if category is listed (for non-admin)
    if (!isAdmin && (!product.category || !product.category.isListed)) {
      return { success: false, message: MESSAGES.PRODUCT.NOT_AVAILABLE };
    }

    // Get variants
    const variantFilter = { product: productId, isDeleted: false };
    if (!isAdmin) {
      variantFilter.isActive = true;
    }

    const variants = await Variant.find(variantFilter).lean();
    product.variants = variants;

    // Calculate pricing and stock
    if (variants.length > 0) {
      const prices = variants.map(v => v.finalPrice ?? v.basePrice);
      product.minPrice = Math.min(...prices);
      product.maxPrice = Math.max(...prices);
      product.totalStock = variants.reduce((sum, v) => sum + v.stock, 0);
      product.bestOffer = Math.max(...variants.map(v => v.offerPercentage || 0));
    }

    // Get related products (same category, different product)
    const relatedProducts = await Product.find({
      category: product.category._id,
      _id: { $ne: productId },
      isDeleted: false,
      isActive: true
    })
    .limit(4)
    .select('name images')
    .lean();

    return {
      success: true,
      product,
      relatedProducts
    };
  } catch (error) {
    console.error('Get product by ID service error:', error);
    return { success: false, message: MESSAGES.PRODUCT.FETCH_ONE_FAILED };
  }
};

// ─── Create new product ───────────────────────────────────────────────────────
export const createProductService = async (productData, files = []) => {
  try {
    const {
      name,
      brand,
      category,
      description,
      caseSize,
      strapType,
      movementType,
      isListed = true,
      variants = []
    } = productData;

    // Validation
    if (!name || !brand || !category) {
      return { success: false, message: MESSAGES.PRODUCT.NAME_REQUIRED };
    }

    if (!description || !description.trim()) {
      return { success: false, message: MESSAGES.PRODUCT.DESC_REQUIRED };
    }

    if (!caseSize?.trim() || !strapType?.trim() || !movementType?.trim()) {
      return { success: false, message: MESSAGES.PRODUCT.SPECS_REQUIRED };
    }

    // Check if category exists
    const categoryExists = await Category.findById(category);
    if (!categoryExists) {
      return { success: false, message: MESSAGES.PRODUCT.CATEGORY_INVALID };
    }

    // Check if product name already exists
    const existingProduct = await Product.findOne({ 
      name: { $regex: `^${name.trim()}$`, $options: 'i' },
      isDeleted: false 
    });
    if (existingProduct) {
      return { success: false, message: MESSAGES.PRODUCT.ALREADY_EXISTS };
    }

    // Parse variants — may come as object map from multipart form
    let parsedVariants = variants;
    if (!Array.isArray(parsedVariants)) {
      // Convert object map { '0': { color, basePrice, ... }, '1': { ... } } to array
      if (typeof parsedVariants === 'object' && parsedVariants !== null) {
        parsedVariants = Object.values(parsedVariants);
      } else {
        parsedVariants = [];
      }
    }

    // Validate variants
    if (parsedVariants.length === 0) {
      return { success: false, message: MESSAGES.PRODUCT.VARIANT_REQUIRED };
    }

    for (let i = 0; i < parsedVariants.length; i++) {
      const variant = parsedVariants[i];
      if (!variant.color || !variant.basePrice || !variant.stock) {
        return { success: false, message: `Variant ${i + 1}: Color, price and stock are required` };
      }
      if (variant.basePrice < 0 || variant.stock < 0) {
        return { success: false, message: `Variant ${i + 1}: Price and stock must be positive` };
      }
    }

    // Create product
    const product = new Product({
      name: name.trim(),
      brand: brand.trim(),
      category,
      description: description.trim(),
      specifications: {
        caseSize:     caseSize?.trim()     || '',
        strapType:    strapType?.trim()    || '',
        movementType: movementType?.trim() || '',
      },
      isActive: isListed === 'on' || isListed === 'true' || isListed === true,
    });

    await product.save();

    // Group uploaded files by variant index
    const filesByVariant = {};
    for (const file of files) {
      const match = file.fieldname.match(/^variantImages_(.+)$/);
      if (!match) continue;
      const idx = match[1];
      if (!filesByVariant[idx]) filesByVariant[idx] = [];
      filesByVariant[idx].push(file);
    }

    // Create variants with their images
    const createdVariants = [];
    // Get the original variant keys to match file indices
    const variantKeys = Object.keys(
      typeof variants === 'object' && !Array.isArray(variants) ? variants : {}
    );

    for (let i = 0; i < parsedVariants.length; i++) {
      const variantData = parsedVariants[i];
      // The file fieldname uses the original form index key (e.g., '0', '1', or timestamp for dynamic)
      const fileKey = variantKeys[i] || i.toString();
      const variantFiles = filesByVariant[fileKey] || [];
      const images = variantFiles.map((f, idx) => ({
        url: f.path, // CloudinaryStorage puts the URL in file.path
        isPrimary: idx === 0,
      }));

      const variant = new Variant({
        product: product._id,
        color: variantData.color.trim(),
        basePrice: parseFloat(variantData.basePrice),
        regularPrice: parseFloat(variantData.regularPrice) || parseFloat(variantData.basePrice),
        stock: parseInt(variantData.stock),
        images,
      });
      await variant.save();
      createdVariants.push(variant);
    }

    return {
      success: true,
      message: 'Product created successfully',
      product,
      variants: createdVariants
    };
  } catch (error) {
    console.error('Create product service error:', error);
    return { success: false, message: MESSAGES.PRODUCT.CREATE_FAILED };
  }
};

// ─── Update product (full: basic fields + variants + images) ─────────────────
export const updateProductService = async (productId, updateData, files = []) => {
  try {
    const product = await Product.findById(productId);
    if (!product || product.isDeleted) {
      return { success: false, message: MESSAGES.PRODUCT.NOT_FOUND };
    }

    // ── 1. Update basic product fields ────────────────────────────────
    const {
      name, brand, category, description,
      caseSize, strapType, movementType, isActive
    } = updateData;

    if (!name?.trim() || !brand?.trim() || !category || !description?.trim()) {
      return { success: false, message: 'Name, brand, category and description are required' };
    }

    await Product.findByIdAndUpdate(productId, {
      name:        name.trim(),
      brand:       brand.trim(),
      category,
      description: description.trim(),
      specifications: {
        caseSize:     caseSize?.trim()     || '',
        strapType:    strapType?.trim()    || '',
        movementType: movementType?.trim() || '',
      },
      // checkbox sends 'true' when checked, 'false' when unchecked
      isActive: isActive === 'on' || isActive === 'true' || isActive === true,
    });

    // ── 2. Parse variants from form data ──────────────────────────────
    // Form sends: variants[0][_id], variants[0][color], variants[0][basePrice], etc.
    // Build a map: index → { _id, color, basePrice, regularPrice, stock }
    const variantMap = {};
    for (const [key, value] of Object.entries(updateData)) {
      const match = key.match(/^variants\[([^\]]+)\]\[([^\]]+)\]$/);
      if (!match) continue;
      const [, idx, field] = match;
      if (!variantMap[idx]) variantMap[idx] = {};
      variantMap[idx][field] = value;
    }

    // ── 3. Group uploaded files by variant index ──────────────────────
    const filesByVariant = {};
    for (const file of files) {
      // fieldname pattern: variantImages_<index>
      const match = file.fieldname.match(/^variantImages_(.+)$/);
      if (!match) continue;
      const idx = match[1];
      if (!filesByVariant[idx]) filesByVariant[idx] = [];
      filesByVariant[idx].push(file);
    }
    console.log(`[UPDATE] Files received: ${files.length}, grouped variants: ${Object.keys(filesByVariant).join(', ') || 'none'}`);
    console.log(`[UPDATE] Variant map keys: ${Object.keys(variantMap).join(', ')}`);
    for (const [idx, vData] of Object.entries(variantMap)) {
      console.log(`[UPDATE] variantMap[${idx}]: _id=${vData._id || 'NEW'}, color=${vData.color}`);
    }

    // ── 3b. Process deferred image deletions ──────────────────────────
    // Form sends deleteImages_0, deleteImages_1, etc. with URLs to remove
    for (const [key, value] of Object.entries(updateData)) {
      const match = key.match(/^deleteImages_(\d+)$/);
      if (!match) continue;
      // value can be a single URL string or an array of URLs
      const urls = Array.isArray(value) ? value : [value];
      const variantIdx = match[1];
      const variantData = variantMap[variantIdx];
      console.log(`[UPDATE] Deleting images for variant idx=${variantIdx}, variantId=${variantData?._id}, urls=${urls.length}`);
      for (const url of urls) {
        if (variantData && variantData._id) {
          await Variant.findByIdAndUpdate(variantData._id, {
            $pull: { images: { url } }
          });
        }
      }
    }

    // ── 4. Process each variant ───────────────────────────────────────
    let uploadWarnings = [];
    for (const [idx, vData] of Object.entries(variantMap)) {
      const { _id, color, basePrice, regularPrice, stock, offerPercentage, offerExpiryDate } = vData;

      if (!color?.trim()) continue; // skip incomplete entries

      const parsedBase    = parseFloat(basePrice)    || 0;
      const parsedRegular = parseFloat(regularPrice) || parsedBase;
      const parsedStock   = parseInt(stock)          || 0;
      const parsedOffer   = parseInt(offerPercentage) || 0;
      const parsedOfferExpiry = offerExpiryDate ? new Date(offerExpiryDate) : null;

      // Upload new images for this variant
      const newImages = [];
      if (filesByVariant[idx]) {
        console.log(`[UPDATE] Variant idx=${idx}: uploading ${filesByVariant[idx].length} new images`);
        for (const file of filesByVariant[idx]) {
          // Safety check: ensure buffer exists
          if (!file.buffer || file.buffer.length === 0) {
            console.error(`[UPDATE] ⚠️ File has no buffer! fieldname=${file.fieldname}, size=${file.size}, buffer=${file.buffer}`);
            uploadWarnings.push(`File ${file.fieldname} has no buffer data`);
            continue;
          }
          try {
            console.log(`[UPDATE] Uploading file: fieldname=${file.fieldname}, size=${file.size}, bufferLen=${file.buffer.length}, mimetype=${file.mimetype}`);
            const uploadResult = await new Promise((resolve, reject) => {
              const stream = cloudinary.uploader.upload_stream(
                {
                  folder: 'neo-luxe/variants',
                  transformation: [
                    { width: 800, height: 800, crop: 'fill' },
                    { quality: 'auto', fetch_format: 'auto' }
                  ]
                },
                (error, result) => {
                  if (error) reject(error);
                  else resolve(result);
                }
              );
              stream.end(file.buffer);
            });
            console.log(`[UPDATE] ✓ Upload success: ${uploadResult.secure_url}`);
            newImages.push({ url: uploadResult.secure_url, isPrimary: false });
          } catch (uploadErr) {
            console.error('[UPDATE] ✗ Cloudinary upload FAILED:', uploadErr.message || uploadErr);
            // Retry without transformation as fallback
            try {
              console.log('[UPDATE] Retrying upload without transformation...');
              const retryResult = await new Promise((resolve, reject) => {
                const stream = cloudinary.uploader.upload_stream(
                  { folder: 'neo-luxe/variants' },
                  (error, result) => {
                    if (error) reject(error);
                    else resolve(result);
                  }
                );
                stream.end(file.buffer);
              });
              console.log(`[UPDATE] ✓ Retry upload success: ${retryResult.secure_url}`);
              newImages.push({ url: retryResult.secure_url, isPrimary: false });
            } catch (retryErr) {
              console.error('[UPDATE] ✗ Retry also FAILED:', retryErr.message || retryErr);
              uploadWarnings.push(`Failed to upload image for variant ${idx}: ${retryErr.message}`);
            }
          }
        }
      }

      if (_id) {
        // ── Existing variant — update fields + append new images ──────
        const variant = await Variant.findById(_id);
        if (!variant || variant.isDeleted) continue;

        console.log(`[UPDATE] Existing variant _id=${_id}, current images=${variant.images.length}, newImages=${newImages.length}`);

        // Update fields first
        variant.color = color.trim();
        variant.basePrice = parsedBase;
        variant.regularPrice = parsedRegular;
        variant.stock = parsedStock;
        variant.offerPercentage = parsedOffer;
        variant.offerExpiryDate = parsedOfferExpiry;

        // Append new images directly to the document
        if (newImages.length > 0) {
          for (const img of newImages) {
            variant.images.push(img);
          }
        }

        // Ensure at least one primary image
        if (variant.images.length > 0 && !variant.images.some(i => i.isPrimary)) {
          variant.images[0].isPrimary = true;
        }

        variant.markModified('images');
        await variant.save();
        console.log(`[UPDATE] Variant saved. Total images now: ${variant.images.length}`);
      } else {
        // ── New variant — create it ───────────────────────────────────
        if (newImages.length > 0) newImages[0].isPrimary = true;

        await Variant.create({
          product:      productId,
          color:        color.trim(),
          basePrice:    parsedBase,
          regularPrice: parsedRegular,
          stock:        parsedStock,
          images:       newImages,
          isActive:     true,
          isDeleted:    false,
        });
      }
    }

    if (uploadWarnings.length > 0) {
      console.warn('[UPDATE] Upload warnings:', uploadWarnings);
      // Still return success but include warning
      return { success: true, message: MESSAGES.PRODUCT.UPDATE_SUCCESS + ' (Warning: some images failed to upload)' };
    }

    return { success: true, message: MESSAGES.PRODUCT.UPDATE_SUCCESS };
  } catch (error) {
    console.error('Update product service error:', error);
    return { success: false, message: MESSAGES.PRODUCT.UPDATE_FAILED };
  }
};

// ─── Soft delete product ──────────────────────────────────────────────────────
export const deleteProductService = async (productId) => {
  try {
    const product = await Product.findById(productId);
    if (!product || product.isDeleted) {
      return { success: false, message: MESSAGES.PRODUCT.NOT_FOUND };
    }

    // Soft delete product and its variants
    await Product.findByIdAndUpdate(productId, { isDeleted: true, isActive: false });
    await Variant.updateMany({ product: productId }, { isDeleted: true, isActive: false });

    return { success: true, message: MESSAGES.PRODUCT.DELETE_SUCCESS };
  } catch (error) {
    console.error('Delete product service error:', error);
    return { success: false, message: MESSAGES.PRODUCT.DELETE_FAILED };
  }
};

// ─── Toggle product status ────────────────────────────────────────────────────
export const toggleProductStatusService = async (productId) => {
  try {
    const product = await Product.findById(productId);
    if (!product || product.isDeleted) {
      return { success: false, message: MESSAGES.PRODUCT.NOT_FOUND };
    }

    const newStatus = !product.isActive;
    await Product.findByIdAndUpdate(productId, { isActive: newStatus });

    return { 
      success: true, 
      message: `Product ${newStatus ? 'activated' : 'deactivated'} successfully`,
      isActive: newStatus
    };
  } catch (error) {
    console.error('Toggle product status service error:', error);
    return { success: false, message: MESSAGES.PRODUCT.STATUS_FAILED };
  }
};

// ─── Get product variants ─────────────────────────────────────────────────────
export const getProductVariantsService = async (productId, isAdmin = false) => {
  try {
    const filter = { product: productId };
    if (!isAdmin) {
      filter.isDeleted = false;
      filter.isActive = true;
    }

    const variants = await Variant.find(filter).lean();
    return { success: true, variants };
  } catch (error) {
    console.error('Get product variants service error:', error);
    return { success: false, message: MESSAGES.PRODUCT.VARIANTS_FAILED };
  }
};

// ─── Check product availability ───────────────────────────────────────────────
export const checkProductAvailabilityService = async (productId, variantId = null) => {
  try {
    const product = await Product.findById(productId).populate('category');
    
    if (!product || product.isDeleted || !product.isActive) {
      return { success: false, available: false, message: 'Product not available' };
    }

    if (!product.category || !product.category.isListed) {
      return { success: false, available: false, message: 'Product category not available' };
    }

    if (variantId) {
      const variant = await Variant.findById(variantId);
      if (!variant || variant.isDeleted || !variant.isActive) {
        return { success: false, available: false, message: 'Variant not available' };
      }
      
      if (variant.stock === 0) {
        return { success: false, available: false, message: 'Out of stock' };
      }

      return { 
        success: true, 
        available: true, 
        stock: variant.stock,
        price: variant.finalPrice ?? variant.basePrice
      };
    }

    // Check if any variant is available
    const availableVariants = await Variant.find({
      product: productId,
      isDeleted: false,
      isActive: true,
      stock: { $gt: 0 }
    });

    if (availableVariants.length === 0) {
      return { success: false, available: false, message: 'No variants available' };
    }

    return { success: true, available: true, variantCount: availableVariants.length };
  } catch (error) {
    console.error('Check product availability service error:', error);
    return { success: false, message: MESSAGES.PRODUCT.AVAILABILITY_FAILED };
  }
};