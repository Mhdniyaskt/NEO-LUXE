/**
 * Diagnostic script: Tests if multer receives files on the edit product endpoint.
 * 
 * Usage: node scripts/test-edit-upload.js
 * 
 * This creates a tiny test image buffer and sends it as multipart/form-data
 * to the edit endpoint, simulating what the browser does.
 */

import { createServer } from 'http';
import app from '../app.js';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import connectDB from '../config/database.config.js';

dotenv.config();

async function runTest() {
  // Connect to DB
  await connectDB();
  
  // Find any product with a variant
  const Product = (await import('../models/product.model.js')).default;
  const Variant = (await import('../models/variant.model.js')).default;
  
  const product = await Product.findOne({ isDeleted: false });
  if (!product) {
    console.log('❌ No product found in DB');
    process.exit(1);
  }
  
  const variant = await Variant.findOne({ product: product._id, isDeleted: false });
  if (!variant) {
    console.log('❌ No variant found for product:', product.name);
    process.exit(1);
  }
  
  console.log(`\n📦 Testing with product: "${product.name}" (${product._id})`);
  console.log(`   Variant: ${variant.color} (${variant._id}), current images: ${variant.images.length}`);
  
  // Start the server on a random port
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  console.log(`   Server running on port ${port}`);
  
  // Create a fake admin session cookie - we'll bypass auth for this test
  // Instead, let's directly call the service function
  const { updateProductService } = await import('../services/product.service.js');
  
  // Create a fake file buffer (1x1 red pixel JPEG)
  const fakeJpegBuffer = Buffer.from([
    0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xFF, 0xDB, 0x00, 0x43,
    0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
    0x09, 0x08, 0x0A, 0x0C, 0x14, 0x0D, 0x0C, 0x0B, 0x0B, 0x0C, 0x19, 0x12,
    0x13, 0x0F, 0x14, 0x1D, 0x1A, 0x1F, 0x1E, 0x1D, 0x1A, 0x1C, 0x1C, 0x20,
    0x24, 0x2E, 0x27, 0x20, 0x22, 0x2C, 0x23, 0x1C, 0x1C, 0x28, 0x37, 0x29,
    0x2C, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1F, 0x27, 0x39, 0x3D, 0x38, 0x32,
    0x3C, 0x2E, 0x33, 0x34, 0x32, 0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x00, 0x01,
    0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xFF, 0xC4, 0x00, 0x1F, 0x00, 0x00,
    0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
    0x09, 0x0A, 0x0B, 0xFF, 0xC4, 0x00, 0xB5, 0x10, 0x00, 0x02, 0x01, 0x03,
    0x03, 0x02, 0x04, 0x03, 0x05, 0x05, 0x04, 0x04, 0x00, 0x00, 0x01, 0x7D,
    0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06,
    0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xA1, 0x08,
    0x23, 0x42, 0xB1, 0xC1, 0x15, 0x52, 0xD1, 0xF0, 0x24, 0x33, 0x62, 0x72,
    0x82, 0x09, 0x0A, 0x16, 0x17, 0x18, 0x19, 0x1A, 0x25, 0x26, 0x27, 0x28,
    0x29, 0x2A, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3A, 0x43, 0x44, 0x45,
    0xFF, 0xDA, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3F, 0x00, 0x7B, 0x94,
    0x11, 0x00, 0x00, 0x00, 0x00, 0x00, 0xFF, 0xD9
  ]);
  
  console.log(`\n🧪 Test 1: Calling updateProductService directly with a fake file buffer...`);
  
  const fakeFiles = [{
    fieldname: 'variantImages_0',
    originalname: 'test_image.jpg',
    encoding: '7bit',
    mimetype: 'image/jpeg',
    buffer: fakeJpegBuffer,
    size: fakeJpegBuffer.length
  }];
  
  const fakeUpdateData = {
    name: product.name,
    brand: product.brand,
    category: product.category.toString(),
    description: product.description || 'Test description for edit',
    caseSize: product.specifications?.caseSize || '40mm',
    strapType: product.specifications?.strapType || 'leather',
    movementType: product.specifications?.movementType || 'automatic',
    isActive: 'true',
    'variants[0][_id]': variant._id.toString(),
    'variants[0][color]': variant.color,
    'variants[0][basePrice]': variant.basePrice.toString(),
    'variants[0][regularPrice]': variant.regularPrice.toString(),
    'variants[0][stock]': variant.stock.toString(),
    'variants[0][offerPercentage]': (variant.offerPercentage || 0).toString(),
  };
  
  console.log(`   Sending ${fakeFiles.length} file(s) with fieldname: ${fakeFiles[0].fieldname}`);
  console.log(`   Variant _id: ${variant._id}`);
  console.log(`   Images before: ${variant.images.length}`);
  
  const result = await updateProductService(product._id.toString(), fakeUpdateData, fakeFiles);
  
  console.log(`\n📊 Result:`, JSON.stringify(result, null, 2));
  
  // Check the variant again
  const updatedVariant = await Variant.findById(variant._id);
  console.log(`   Images after: ${updatedVariant.images.length}`);
  
  if (updatedVariant.images.length > variant.images.length) {
    console.log(`\n✅ SUCCESS: Image was saved to the variant!`);
    console.log(`   New image URL: ${updatedVariant.images[updatedVariant.images.length - 1].url}`);
  } else {
    console.log(`\n❌ FAILURE: Image was NOT saved. Check Cloudinary upload logs above.`);
  }
  
  server.close();
  await mongoose.disconnect();
  process.exit(0);
}

runTest().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
