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
    return res.status(400).json({
      success: false,
      message: "Name, brand and category are required",
    });
  }

  if (!variants) {
    return res.status(400).json({
      success: false,
      message: "Variant data missing",
    });
  }

  const variantArray = Array.isArray(variants)
    ? variants
    : Object.values(variants);

  if (variantArray.length === 0) {
    return res.status(400).json({
      success: false,
      message: "At least one variant is required",
    });
  }

  // --- 2. STRING VALIDATION ---
  if (name.trim().length < 3) {
    return res.status(400).json({
      success: false,
      message: "Product name must be at least 3 characters",
    });
  }

  // --- 3. CATEGORY VALIDATION ---
  const categoryExists = await Category.findById(category);
  if (!categoryExists) {
    return res.status(400).json({
      success: false,
      message: "Invalid category",
    });
  }

  // --- 4. DUPLICATE PRODUCT CHECK ---
  const existing = await Product.findOne({
    name: name.trim(),
    isDeleted: false,
  });

  if (existing) {
    return res.status(400).json({
      success: false,
      message: "Product already exists",
    });
  }

  // --- 5. DUPLICATE VARIANT COLOR CHECK ---
  const colors = variantArray.map(v => v.color?.toLowerCase());
  if (new Set(colors).size !== colors.length) {
    return res.status(400).json({
      success: false,
      message: "Duplicate variant colors not allowed",
    });
  }

  // --- TECHNICAL SPECS VALIDATION ---
  if (!caseSize || caseSize.trim().length === 0) {
    return res.status(400).json({
      success: false,
      message: "Case size is required",
    });
  }

  if (!strapType || strapType.trim().length === 0) {
    return res.status(400).json({
      success: false,
      message: "Strap type is required",
    });
  }

  if (!movementType || movementType.trim().length === 0) {
    return res.status(400).json({
      success: false,
      message: "Movement type is required",
    });
  }



  // --- 7. CREATE VARIANTS ---
  for (let i = 0; i < variantArray.length; i++) {
    const v = variantArray[i];

    // --- Variant validation ---
    if (!v.color) {
      return res.status(400).json({
        success: false,
        message: `Color is required for variant ${i + 1}`,
      });
    }

    const regularPrice = Number(v.regularPrice);
    if (!regularPrice || regularPrice <= 0) {
      return res.status(400).json({
        success: false,
        message: `Invalid regular price for variant ${i + 1}`,
      });
    }

    const basePrice = Number(v.basePrice);
    if (!basePrice || basePrice <= 0) {
      return res.status(400).json({
        success: false,
        message: `Invalid base price for variant ${i + 1}`,
      });
    }

    if (basePrice > regularPrice) {
      return res.status(400).json({
        success: false,
        message: `Base price cannot be greater than regular price for variant ${i + 1}`,
      });
    }

    const stock = Number(v.stock || 0);
    if (stock < 0) {
      return res.status(400).json({
        success: false,
        message: `Stock cannot be negative for variant ${i + 1}`,
      });
    }

    // --- IMAGE HANDLING ---
    const variantFiles = (req.files || []).filter(
      (file) => file.fieldname === `variantImages_${i}`
    );

    if (variantFiles.length === 0) {
      return res.status(400).json({
        success: false,
        message: `At least one image required for variant ${i + 1}`,
      });
    }

    // --- IMAGE TYPE VALIDATION ---
    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
    variantFiles.forEach(file => {
      if (!allowedTypes.includes(file.mimetype)) {
        throw new Error("Invalid image format");
      }
    });

      // --- 6. CREATE PRODUCT ---
  const product = await Product.create({
    name: name.trim(),
    brand: brand.trim(),
    category,
    description,
    specifications: { caseSize, strapType, movementType },
    isActive: Boolean(isListed),
  });

    // --- SAVE VARIANT ---
    await Variant.create({
      product: product._id,
      color: v.color,
      stock,
      regularPrice,
      basePrice,
      images: variantFiles.map((file, idx) => ({
        url: file.path || file.filename,
        isPrimary: idx === 0,
      })),
    });
  }

  return res.status(201).json({
    success: true,
    message: "Product added successfully",
  });
});



export const geteditProduct = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) return res.redirect("/admin/products");

  const categories = await Category.find({ isListed: true });
  const variants = await Variant.find({
    product: product._id,
    isDeleted: false,
  });

  // Attach variants to the product object before rendering
  const productData = product.toObject();
  productData.variants = variants;
  
  
  res.render("admin/edit-product", {
    product: productData, // Now product.variants will exist
    categories,
    layout: "layouts/admin",
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

    const variantArray = Array.isArray(variants) ? variants : Object.values(variants || {});

    // 2. PRE-VALIDATION PASS: Check all variants before saving anything
    for (let i = 0; i < variantArray.length; i++) {
        const v = variantArray[i];
        const regularPrice = Number(v.regularPrice);
        const basePrice = Number(v.basePrice);
        const stock = Number(v.stock);

        if (isNaN(regularPrice) || regularPrice <= 0) {
            return res.status(400).json({ 
                success: false, 
                message: `Variant ${i + 1}: Regular Price (MRP) must be a valid number greater than 0.` 
            });
        }

        if (isNaN(basePrice) || basePrice <= 0) {
            return res.status(400).json({ 
                success: false, 
                message: `Variant ${i + 1}: Sale price must be a valid number greater than 0.` 
            });
        }

        if (basePrice > regularPrice) {
            return res.status(400).json({ 
                success: false, 
                message: `Variant ${i + 1}: Sale price (${basePrice}) cannot be higher than the Regular price (${regularPrice}).` 
            });
        }

        if (isNaN(stock) || stock < 0) {
            return res.status(400).json({ 
                success: false, 
                message: `Variant ${i + 1}: Stock cannot be negative.` 
            });
        }
    }
// Ensure this part in your controller handles the isActive checkbox correctly
const isListedBool = isActive === "on" || isActive === "true" || isActive === true;

    // 3. Update Main Product Info (Only runs if all variants passed validation)
    const updatedProduct = await Product.findByIdAndUpdate(id, {
        name,
        category,
        brand,
        description,
        specifications: { caseSize, strapType, movementType },
        isActive: isListedBool
    }, { new: true });

    if (!updatedProduct) {
        return res.status(404).json({ success: false, message: "Product not found" });
    }

    // 4. Process Variants
    for (let i = 0; i < variantArray.length; i++) {
        const v = variantArray[i];
        
        // Handle Images
        const newFiles = req.files ? req.files.filter(f => f.fieldname === `variantImages_${i}`) : [];
        let keptImages = req.body[`existingImages_${i}`] || [];
        if (!Array.isArray(keptImages)) keptImages = [keptImages];

        const finalImages = [
            ...keptImages.map(url => ({ url, isPrimary: false })),
            ...newFiles.map(f => ({ url: f.path || f.filename, isPrimary: false }))
        ];

        if (finalImages.length > 0) finalImages[0].isPrimary = true;

        // ... inside your loop after handling images ...

if (v._id) {
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

    // CRITICAL: Link the new variant to the Product document
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
