import asyncHandler from "../../utils/asyncHandler.util.js";
import Category from "../../models/category.model.js";
import Product from "../../models/product.model.js";
import Variant from "../../models/variant.model.js";

export const getProductPage = asyncHandler(async (req, res) => {
  const page = Number(req.query.page) || 1;
  const limit = 5;
  const skip = (page - 1) * limit;
  const { search, brand } = req.query;

  const filter = { isDeleted: false };
  if (search && typeof search === "string" && search.trim() !== "") {
    filter.name = { $regex: search.trim(), $options: "i" };
  }
  if (brand && brand !== "") {
    filter.brand = brand;
  }

  const products = await Product.find(filter)
    .populate("category", "name")
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  
  for (let product of products) {
    const variants = await Variant.find({
      product: product._id,
      isDeleted: false,
    }).lean();

    product.variants = variants;
    product.bestOffer =
      variants.length > 0
        ? Math.max(...variants.map((v) => v.offerPercentage || 0))
        : 0;
    product.minPrice =
      variants.length > 0
        ? Math.min(...variants.map((v) => v.finalPrice ?? v.basePrice))
        : null;
    product.totalStock = variants.reduce((sum, v) => sum + v.stock, 0);
  }

  const brands = await Product.distinct("brand", { isDeleted: false });

  const totalProducts = await Product.countDocuments(filter);
  const totalPages = Math.ceil(totalProducts / limit);

  res.render("admin/products", {
    layout: "layouts/admin",
    products,
    brands,
    currentPage: page,
    totalPages,
    search: search || "",
    selectedBrand: brand || "",
  });
});

export const getaddProducts = asyncHandler(async (req, res) => {
  const categories = await Category.find({ isListed: true });
  res.render("admin/add-product", { categories, layout: "layouts/admin" });
});

export const postAddProducts = asyncHandler(async (req, res) => {
    const {
        name,
        brand,
        category,
        description,
        caseSize,
        strapType,
        movementType,
        isListed,
        variants,
    } = req.body;

    // --- 1. BASIC REQUIRED VALIDATION ---
    if (!name || !brand || !category) {
        return res.status(400).json({ success: false, message: "Name, brand and category are required" });
    }

    if (!description || !description.trim()) {
        return res.status(400).json({ success: false, message: "Product description is required" });
    }

    if (!caseSize?.trim() || !strapType?.trim() || !movementType?.trim()) {
        return res.status(400).json({ success: false, message: "All technical specifications are required" });
    }

    if (!variants) {
        return res.status(400).json({ success: false, message: "Variant data missing" });
    }

    const variantArray = Array.isArray(variants) ? variants : Object.values(variants);

    if (variantArray.length === 0) {
        return res.status(400).json({ success: false, message: "At least one variant is required" });
    }

    // --- 2. STRING & CATEGORY VALIDATION ---
    if (name.trim().length < 3) {
        return res.status(400).json({ success: false, message: "Product name must be at least 3 characters" });
    }

    const categoryExists = await Category.findById(category);
    if (!categoryExists) {
        return res.status(400).json({ success: false, message: "Invalid category" });
    }

    // --- 3. DUPLICATE PRODUCT CHECK ---
    const existing = await Product.findOne({ name: name.trim(), isDeleted: false });
    if (existing) {
        return res.status(400).json({ success: false, message: "Product already exists" });
    }

    // --- 4. PRE-VALIDATION PASS ---
    // Check all variants BEFORE creating the product so no ghost records are left.
    const colors = [];
    for (let i = 0; i < variantArray.length; i++) {
        const v = variantArray[i];
        const regularPrice = Number(v.regularPrice);
        const basePrice    = Number(v.basePrice);
        const stock        = Number(v.stock || 0);

        if (!v.color || regularPrice <= 0 || basePrice <= 0 || stock < 0) {
            return res.status(400).json({ success: false, message: `Invalid data for variant ${i + 1}` });
        }
        if (basePrice > regularPrice) {
            return res.status(400).json({ success: false, message: `Variant ${i + 1}: Sale price cannot exceed Regular Price.` });
        }
        if (colors.includes(v.color.toLowerCase())) {
            return res.status(400).json({ success: false, message: `Duplicate variant color: ${v.color}` });
        }
        colors.push(v.color.toLowerCase());

        // Images are keyed by the variant's object key (vId from frontend), not loop index.
        // The frontend sends fieldname `variantImages_<vId>` where vId is the JS counter value.
        // We derive the vId from the variants object keys to match correctly.
    }

    // Derive the original variant keys (vIds) from req.body.variants object
    // so image fieldname matching works even when variants were deleted/re-added.
    const variantKeys = Array.isArray(variants)
        ? variantArray.map((_, i) => String(i))
        : Object.keys(variants);

    // Verify every variant has at least one uploaded image
    for (let i = 0; i < variantKeys.length; i++) {
        const vId = variantKeys[i];
        const hasImages = (req.files || []).some(f => f.fieldname === `variantImages_${vId}`);
        if (!hasImages) {
            return res.status(400).json({ success: false, message: `Variant ${i + 1}: At least one image is required.` });
        }
    }

    // --- 5. CREATE PRODUCT (ONLY AFTER ALL VALIDATIONS PASS) ---
    const product = await Product.create({
        name: name.trim(),
        brand: brand.trim(),
        category,
        description,
        specifications: { caseSize, strapType, movementType },
        isActive: isListed === "true" || isListed === "on" || isListed === true,
    });

    // --- 6. CREATE VARIANTS ---
    for (let i = 0; i < variantArray.length; i++) {
        const v      = variantArray[i];
        const vId    = variantKeys[i];   // use the original key for image fieldname matching
        const variantFiles = (req.files || []).filter(f => f.fieldname === `variantImages_${vId}`);

        await Variant.create({
            product:      product._id,
            color:        v.color,
            stock:        Number(v.stock),
            regularPrice: Number(v.regularPrice),
            basePrice:    Number(v.basePrice),
            images:       variantFiles.map((file, idx) => ({
                url:       file.path || file.filename,
                isPrimary: idx === 0,
            })),
        });
    }

    return res.status(201).json({
        success: true,
        message: "Product and all variants added successfully",
    });
});



export const geteditProduct = asyncHandler(async (req, res) => {
    const { id } = req.params;
    
    // 1. REMOVE .populate('variants') here. 
    // Just find the product by ID.
    const product = await Product.findById(id); 

    if (!product) return res.redirect("/admin/products");

    const categories = await Category.find({ isListed: true });
    
    // 2. You are ALREADY doing this correctly! 
    // This fetches all variants linked to the product.
    const variants = await Variant.find({
        product: product._id,
        isDeleted: false,
    });

    res.render("admin/edit-product", { 
        product, 
        categories, 
        variants,
        layout: "layouts/admin" 
    });
});



export const postEditProduct = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const {
        name, category, brand, description,
        caseSize, strapType, movementType,
        isActive, variants
    } = req.body;

    // 1. Basic Product Validation
    if (!name || !brand || !category) {
        return res.status(400).json({ success: false, message: "Required fields are missing." });
    }

    // Convert variants object/array into a workable array of [key, value] pairs
    // This allows us to access the original 'index' (like the timestamp) for image mapping
    const variantEntries = Object.entries(variants || {});

    // 2. PRE-VALIDATION PASS
    for (const [index, v] of variantEntries) {
        const regularPrice = Number(v.regularPrice);
        const basePrice = Number(v.basePrice);
        const stock = Number(v.stock);

        if (isNaN(regularPrice) || regularPrice <= 0 || isNaN(basePrice) || basePrice <= 0) {
            return res.status(400).json({ 
                success: false, 
                message: `Variant ${v.color || ''}: Prices must be valid numbers greater than 0.` 
            });
        }

        if (basePrice > regularPrice) {
            return res.status(400).json({ 
                success: false, 
                message: `Variant ${v.color || ''}: Sale price cannot be higher than the Regular price.` 
            });
        }

        if (isNaN(stock) || stock < 0) {
            return res.status(400).json({ success: false, message: `Variant ${v.color || ''}: Stock cannot be negative.` });
        }

        // IMAGE VALIDATION FOR NEW VARIANTS
        // We use the 'index' from the object key to match 'variantImages_TIMESTAMP'
        if (!v._id || v._id === 'undefined') {
            const newFiles = req.files ? req.files.filter(f => f.fieldname === `variantImages_${index}`) : [];
            if (newFiles.length === 0) {
                return res.status(400).json({ 
                    success: false, 
                    message: `New variant (${v.color}): At least one image is required.` 
                });
            }
        }
    }

    const isListedBool = isActive === "on" || isActive === "true" || isActive === true;

    // 3. Update Main Product Info
    const updatedProduct = await Product.findByIdAndUpdate(id, {
        name: name.trim(),
        category,
        brand: brand.trim(),
        description,
        specifications: { caseSize, strapType, movementType },
        isActive: isListedBool
    }, { new: true });

    if (!updatedProduct) {
        return res.status(404).json({ success: false, message: "Product not found" });
    }

    // 4. Process Variants
    for (const [index, v] of variantEntries) {
        
        // Match images using the unique key (timestamp or array index) from frontend
        const newFiles = req.files ? req.files.filter(f => f.fieldname === `variantImages_${index}`) : [];
        let keptImages = req.body[`existingImages_${index}`] || [];
        if (!Array.isArray(keptImages)) keptImages = [keptImages];

        const finalImages = [
            ...keptImages.map(url => ({ url, isPrimary: false })),
            ...newFiles.map(f => ({ url: f.path || f.filename, isPrimary: false }))
        ];

        if (finalImages.length > 0) finalImages[0].isPrimary = true;

        // Check if it's an existing variant or a new one
        if (v._id && v._id !== 'undefined' && v._id.length > 5) {
            // Update existing variant
            await Variant.findByIdAndUpdate(v._id, {
                color: v.color,
                stock: Number(v.stock),
                regularPrice: Number(v.regularPrice),
                basePrice: Number(v.basePrice),
                images: finalImages,
                isActive: true
            });
        } else {
            // Create new variant
            const newVariant = await Variant.create({
                product: id,
                color: v.color,
                stock: Number(v.stock),
                regularPrice: Number(v.regularPrice),
                basePrice: Number(v.basePrice),
                images: finalImages,
                isActive: true
            });

            // IMPORTANT: Link the new variant ID to the Product's variants array
            await Product.findByIdAndUpdate(id, {
                $push: { variants: newVariant._id }
            });
        }
    }

    res.json({ success: true, message: "Product and variants updated successfully" });
});

// @desc    Update Product & Variants


export const deleteVariantImage = asyncHandler(async (req, res) => {
    const { productId, variantId, imageName } = req.params;

    // Use $pull to remove the image object that contains the imageName in its URL
    // We use a regex or 'endsWith' check if the imageName is just a filename 
    // but the DB stores the full path.
    const updatedVariant = await Variant.findByIdAndUpdate(
        variantId,
        {
            $pull: {
                images: { 
                    url: { $regex: imageName + "$" } 
                }
            }
        },
        { new: true }
    );

    if (!updatedVariant) {
        return res.status(404).json({ success: false, message: "Variant not found" });
    }

    // Optional: If the variant now has no primary image, set the first one as primary
    if (updatedVariant.images.length > 0 && !updatedVariant.images.find(img => img.isPrimary)) {
        updatedVariant.images[0].isPrimary = true;
        await updatedVariant.save();
    }

    res.json({ success: true, message: "Image removed successfully" });
});
// @desc    Soft Delete Product
export const softDeleteProduct = asyncHandler(async (req, res) => {
  const { id } = req.params;
  await Product.findByIdAndUpdate(id, { isDeleted: true, isActive: false });
  await Variant.updateMany(
    { product: id },
    { isDeleted: true, isActive: false },
  );
  res.json({ success: true, message: "Product and variants moved to trash" });
});

// @desc    Toggle product isActive (list / unlist)
export const toggleProductStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const product = await Product.findById(id);
  if (!product) return res.status(404).json({ success: false, message: "Product not found" });

  product.isActive = !product.isActive;
  await product.save();

  res.json({
    success: true,
    isActive: product.isActive,
    message: product.isActive ? "Product listed successfully" : "Product unlisted successfully",
  });
});

// @desc    Check if product name already exists (for live validation)
export const checkProductName = asyncHandler(async (req, res) => {
  const { name, excludeId } = req.query;
  if (!name || !name.trim()) {
    return res.json({ exists: false });
  }
  const query = {
    name: { $regex: `^${name.trim()}$`, $options: 'i' },
    isDeleted: false,
  };
  if (excludeId) {
    query._id = { $ne: excludeId };
  }
  const existing = await Product.findOne(query).lean();
  res.json({ exists: !!existing });
});
