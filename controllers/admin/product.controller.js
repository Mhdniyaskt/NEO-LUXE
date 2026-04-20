import asyncHandler from '../../utils/asyncHandler.util.js';
import Category from '../../models/category.model.js';
import Product from '../../models/product.model.js';
import Variant from '../../models/variant.model.js';

// @desc    Get all products with variant data & brand filtering
// @route   GET /admin/products
export const getProductPage = asyncHandler(async (req, res) => {
    const page = Number(req.query.page) || 1;
    const limit = 5;
    const skip = (page - 1) * limit;
    const { search, brand } = req.query;

    const filter = { isDeleted: false };
    if (search && typeof search === 'string' && search.trim() !== '') {
        filter.name = { $regex: search.trim(), $options: 'i' };
    }
    if (brand && brand !== '') {
        filter.brand = brand;
    }

    const products = await Product.find(filter)
        .populate('category', 'name')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean();

    // Attach variant data and calculate analytics for the list view
    for (let product of products) {
        const variants = await Variant.find({
            product: product._id,
            isDeleted: false,
        }).lean();

        product.variants = variants;
        product.bestOffer = variants.length > 0 ? Math.max(...variants.map((v) => v.offerPercentage || 0)) : 0;
        product.minPrice = variants.length > 0 ? Math.min(...variants.map((v) => v.finalPrice ?? v.basePrice)) : null;
        product.totalStock = variants.reduce((sum, v) => sum + v.stock, 0);
    }

    // Fetch unique brands for the dropdown filter
    const brands = await Product.distinct('brand', { isDeleted: false });

    const totalProducts = await Product.countDocuments(filter);
    const totalPages = Math.ceil(totalProducts / limit);

    res.render('admin/products', {
        layout: 'layouts/admin',
        products,
        brands,
        currentPage: page,
        totalPages,
        search: search || '',
        selectedBrand: brand || '',
    });
});

// @desc    Render Add Product Page
export const getaddProducts = asyncHandler(async (req, res) => {
    const categories = await Category.find({ isListed: true });
    res.render('admin/add-product', { categories, layout: 'layouts/admin' });
});

// @desc    Create Product & Variants
// ... (imports remain the same)

// @desc    Create Product & Variants
export const postAddProducts = asyncHandler(async (req, res) => {
    const {
        name, brand, category, description,
        offerPercentage, offerExpiry,
        caseSize, strapType, movementType,
        isListed, variants,
    } = req.body;

    if (!variants) return res.status(400).json({ success: false, message: 'Variant data missing' });

    const variantArray = Array.isArray(variants) ? variants : Object.values(variants);

    // --- 1. VALIDATIONS ---
    const existing = await Product.findOne({ name: name.trim(), isDeleted: false });
    if (existing) return res.status(400).json({ success: false, message: 'Product already exists' });

    // --- 2. CREATE PRODUCT ---
    const product = await Product.create({
        name: name.trim(),
        brand: brand.trim(),
        category,
        description,
        offerPercentage: Number(offerPercentage || 0),
        offerExpiry: Number(offerPercentage) > 0 ? offerExpiry : null,
        specifications: { caseSize, strapType, movementType },
        isActive: isListed === 'on' || isListed === true,
    });

    // --- 3. CREATE VARIANTS & MAP IMAGES ---
    for (let i = 0; i < variantArray.length; i++) {
        const v = variantArray[i];
        // Filter files for this specific variant
        const variantFiles = req.files.filter((file) => file.fieldname === `variantImages_${i}`);
        
        const basePrice = Number(v.basePrice);
        const finalPrice = Math.round(basePrice - (basePrice * Number(offerPercentage || 0)) / 100);

        await Variant.create({
            product: product._id,
            color: v.color,
            stock: Number(v.stock || 0),
            basePrice,
            finalPrice,
            images: variantFiles.map((file, idx) => ({
                // file.path contains the full Cloudinary URL
                url: file.path || file.filename, 
                isPrimary: idx === 0,
            })),
        });
    }

    return res.status(201).json({ success: true, message: 'Product added successfully' });
});

// @desc    Update Product & Variants
export const postEditProduct = asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { name, category, brand, description, offerPercentage, offerExpiry, caseSize, strapType, movementType, isListed, variants } = req.body;

    const variantArray = Array.isArray(variants) ? variants : Object.values(variants);
    const offer = Number(offerPercentage || 0);

    await Product.findByIdAndUpdate(id, {
        name, category, brand, description,
        offerPercentage: offer,
        offerExpiry: offer > 0 ? offerExpiry : null,
        specifications: { caseSize, strapType, movementType },
        isActive: isListed === 'on',
    });

    for (let i = 0; i < variantArray.length; i++) {
        const v = variantArray[i];
        const newFiles = req.files.filter((f) => f.fieldname === `variantImages_${i}`);
        let keptImages = req.body[`existingImages_${i}`] || [];
        if (!Array.isArray(keptImages)) keptImages = [keptImages];

        const basePrice = Number(v.basePrice);
        const finalPrice = Math.round(basePrice - (basePrice * offer) / 100);

        // Combine existing URLs with new Cloudinary paths
        const finalImages = [
            ...keptImages.map(url => ({ url, isPrimary: false })),
            ...newFiles.map(f => ({ url: f.path || f.filename, isPrimary: false }))
        ];
        if (finalImages.length > 0) finalImages[0].isPrimary = true;

        if (v._id) {
            await Variant.findByIdAndUpdate(v._id, {
                color: v.color, stock: Number(v.stock), basePrice, finalPrice, images: finalImages, isDeleted: false, isActive: true
            });
        } else {
            await Variant.create({ product: id, color: v.color, stock: Number(v.stock), basePrice, finalPrice, images: finalImages });
        }
    }
    res.json({ success: true, message: 'Product updated successfully' });
});
export const geteditProduct = asyncHandler(async (req, res) => {
    const product = await Product.findById(req.params.id);
    if (!product) return res.redirect('/admin/products');

    const categories = await Category.find({ isListed: true });
    const variants = await Variant.find({ product: product._id, isDeleted: false });

    // Attach variants to the product object before rendering
    const productData = product.toObject();
    productData.variants = variants;
    res.render('admin/edit-product', {
        product: productData, // Now product.variants will exist
        categories,
        layout: 'layouts/admin',
    });
});

// @desc    Update Product & Variants


// @desc    Soft Delete Product
export const softDeleteProduct = asyncHandler(async (req, res) => {
    const { id } = req.params;
    await Product.findByIdAndUpdate(id, { isDeleted: true, isActive: false });
    await Variant.updateMany({ product: id }, { isDeleted: true, isActive: false });
    res.json({ success: true, message: 'Product and variants moved to trash' });
});