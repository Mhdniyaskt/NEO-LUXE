import asyncHandler from "../../utils/asyncHandler.util.js";
import {
  getProductsService,
  getProductByIdService,
  createProductService,
  updateProductService,
  deleteProductService,
  toggleProductStatusService,
  getProductVariantsService
} from "../../services/product.service.js";
import { getCategoriesForSelectService } from "../../services/category.service.js";
import Variant from "../../models/variant.model.js";
import Product from "../../models/product.model.js";

export const getProductPage = asyncHandler(async (req, res) => {
  const { page = 1, search = '', brand = '' } = req.query;
  
  const result = await getProductsService({
    page: parseInt(page),
    limit: 5,
    search,
    brand,
    isAdmin: true
  });

  if (!result.success) {
    return res.status(500).render('error', {
      message: result.message,
      layout: 'layouts/admin'
    });
  }

  res.render("admin/products", {
    layout: "layouts/admin",
    products: result.products,
    brands: result.filters.brands,
    currentPage: result.pagination.currentPage,
    totalPages: result.pagination.totalPages,
    search: search || "",
    selectedBrand: brand || "",
  });
});

export const getaddProducts = asyncHandler(async (req, res) => {
  const result = await getCategoriesForSelectService(true);
  const categories = result.success ? result.categories : [];
  
  res.render("admin/add-product", { 
    categories, 
    layout: "layouts/admin" 
  });
});

export const postAddProducts = asyncHandler(async (req, res) => {
  const result = await createProductService(req.body, req.files || []);
  
  if (result.success) {
    return res.status(201).json({
      success: true,
      message: result.message,
      productId: result.product._id
    });
  }
  
  return res.status(400).json(result);
});

export const geteditProduct = asyncHandler(async (req, res) => {
  const { id } = req.params;
  
  const productResult = await getProductByIdService(id, true);
  if (!productResult.success) {
    return res.redirect("/admin/products");
  }

  const categoriesResult = await getCategoriesForSelectService(true);
  const categories = categoriesResult.success ? categoriesResult.categories : [];

  res.render("admin/edit-product", {
    layout: "layouts/admin",
    product: productResult.product,
    categories,
    variants: productResult.product.variants || []
  });
});

export const postEditProduct = asyncHandler(async (req, res) => {
  const { id } = req.params;
  
  // ── Diagnostic logging ──────────────────────────────────────────
  const fileCount = (req.files || []).length;
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`[EDIT PRODUCT] id=${id}`);
  console.log(`[EDIT PRODUCT] req.files: ${fileCount} file(s)`);
  if (fileCount > 0) {
    req.files.forEach((f, i) => {
      console.log(`[EDIT PRODUCT]   file[${i}]: fieldname="${f.fieldname}", size=${f.size}, mime=${f.mimetype}, buffer=${f.buffer ? f.buffer.length + 'B' : 'NULL!'}`);
    });
  } else {
    console.log(`[EDIT PRODUCT]   ⚠️  NO FILES received from browser`);
  }
  const variantBodyKeys = Object.keys(req.body).filter(k => k.startsWith('variants['));
  console.log(`[EDIT PRODUCT] Variant body fields: ${variantBodyKeys.length}`);
  console.log(`${'═'.repeat(60)}\n`);
  
  const result = await updateProductService(id, req.body, req.files || []);
  
  if (result.success) {
    return res.json({ success: true, message: result.message, filesReceived: fileCount });
  }
  
  return res.status(400).json(result);
});

export const deleteVariantImage = asyncHandler(async (req, res) => {
  const { productId, variantId } = req.params;
  const { imageUrl } = req.body;

  if (!imageUrl) {
    return res.status(400).json({ success: false, message: "Image URL is required" });
  }

  // Pull the image by exact URL match
  const updatedVariant = await Variant.findByIdAndUpdate(
    variantId,
    { $pull: { images: { url: imageUrl } } },
    { new: true }
  );

  if (!updatedVariant) {
    return res.status(404).json({ success: false, message: "Variant not found" });
  }

  // If no primary image remains, promote the first one
  if (updatedVariant.images.length > 0 && !updatedVariant.images.find(img => img.isPrimary)) {
    updatedVariant.images[0].isPrimary = true;
    await updatedVariant.save();
  }

  res.json({ success: true, message: "Image removed successfully" });
});

// @desc    Replace a variant image
export const replaceVariantImage = asyncHandler(async (req, res) => {
  const { productId, variantId } = req.params;
  const { oldImageUrl } = req.body;
  const file = req.file; // single file from upload.single('image')

  if (!oldImageUrl || !file) {
    return res.status(400).json({ success: false, message: "Old image URL and new image file are required" });
  }

  // Upload new image to Cloudinary from buffer
  const cloudinary = (await import('../../config/cloudinary.config.js')).default;
  
  let newUrl;
  try {
    const uploadResult = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: 'neo-luxe/variants', transformation: [{ width: 800, height: 800, crop: 'fill' }, { quality: 'auto', fetch_format: 'auto' }] },
        (error, result) => { if (error) reject(error); else resolve(result); }
      );
      stream.end(file.buffer);
    });
    newUrl = uploadResult.secure_url;
  } catch (err) {
    console.error('Cloudinary replace upload error:', err);
    return res.status(500).json({ success: false, message: "Failed to upload new image" });
  }

  // Find the variant and replace the image URL
  const variant = await Variant.findById(variantId);
  if (!variant) return res.status(404).json({ success: false, message: "Variant not found" });

  const imgIndex = variant.images.findIndex(img => img.url === oldImageUrl);
  if (imgIndex === -1) {
    return res.status(404).json({ success: false, message: "Original image not found in variant" });
  }

  // Replace the URL, keep isPrimary status
  variant.images[imgIndex].url = newUrl;
  variant.markModified('images');
  await variant.save();

  res.json({ success: true, message: "Image replaced successfully", newUrl });
});

// @desc    Soft Delete Product
export const softDeleteProduct = asyncHandler(async (req, res) => {
  const { id } = req.params;
  
  const result = await deleteProductService(id);
  
  if (result.success) {
    return res.json(result);
  }
  
  return res.status(400).json(result);
});

// @desc    Toggle product isActive (list / unlist)
export const toggleProductStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  
  const result = await toggleProductStatusService(id);
  
  if (result.success) {
    return res.json({
      success: true,
      isActive: result.isActive,
      message: result.message
    });
  }
  
  return res.status(400).json(result);
});

// @desc    Check if product name already exists (for live validation)
export const checkProductName = asyncHandler(async (req, res) => {
  const { name, excludeId } = req.query;
  if (!name || !name.trim()) {
    return res.json({ exists: false });
  }

  const filter = { 
    name: { $regex: `^${name.trim()}$`, $options: 'i' },
    isDeleted: false 
  };
  
  if (excludeId) {
    filter._id = { $ne: excludeId };
  }

  const existing = await Product.findOne(filter);
  res.json({ exists: !!existing });
});