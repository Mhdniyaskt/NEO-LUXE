/**
 * Test script: Sends a real multipart/form-data PUT request to the edit endpoint
 * simulating exactly what the browser does.
 * 
 * Usage: 
 *   1. Start your server: node server.js
 *   2. In another terminal: node scripts/test-image-push.js
 * 
 * This will tell you definitively if the issue is browser→server or server→cloudinary.
 */

import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import connectDB from '../config/database.config.js';
import Product from '../models/product.model.js';
import Variant from '../models/variant.model.js';

// We'll use native fetch (Node 18+) with a FormData polyfill
import { Blob } from 'buffer';

async function main() {
  await connectDB();
  
  // Find a product with a variant
  const product = await Product.findOne({ isDeleted: false });
  if (!product) { console.log('No product found'); process.exit(1); }
  
  const variant = await Variant.findOne({ product: product._id, isDeleted: false });
  if (!variant) { console.log('No variant found'); process.exit(1); }
  
  console.log(`\nProduct: "${product.name}" (${product._id})`);
  console.log(`Variant: ${variant.color} (${variant._id}), images: ${variant.images.length}`);
  
  // Create a real 10x10 red JPEG using a minimal valid JPEG
  // This is a proper 1x1 JPEG that Cloudinary will accept
  const { createCanvas } = await import('canvas').catch(() => null) || {};
  
  // Use a base64-encoded minimal valid JPEG (1x1 pixel, red)
  const minimalJpeg = Buffer.from(
    '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYI4Q/SFhSRFJiY0VVcnPEBRdkdMICoSGhkJGmo7Ck0dHV1tfY2drk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+gD/2Q==',
    'base64'
  );
  
  console.log(`\nTest JPEG size: ${minimalJpeg.length} bytes`);
  console.log(`Sending PUT request to http://localhost:3000/admin/products/edit/${product._id}`);
  
  // Build FormData manually
  const formData = new FormData();
  formData.append('name', product.name);
  formData.append('brand', product.brand);
  formData.append('category', product.category.toString());
  formData.append('description', product.description || 'Test description');
  formData.append('caseSize', product.specifications?.caseSize || '40mm');
  formData.append('strapType', product.specifications?.strapType || 'leather');
  formData.append('movementType', product.specifications?.movementType || 'automatic');
  formData.append('isActive', 'true');
  
  // Variant fields
  formData.append('variants[0][_id]', variant._id.toString());
  formData.append('variants[0][color]', variant.color);
  formData.append('variants[0][basePrice]', variant.basePrice.toString());
  formData.append('variants[0][regularPrice]', variant.regularPrice.toString());
  formData.append('variants[0][stock]', variant.stock.toString());
  formData.append('variants[0][offerPercentage]', (variant.offerPercentage || 0).toString());
  
  // Append the image blob (simulating what the browser cropper does)
  const imageBlob = new Blob([minimalJpeg], { type: 'image/jpeg' });
  formData.append('variantImages_0', imageBlob, 'test_crop_0.jpg');
  
  console.log(`FormData entries: ${[...formData.keys()].length}`);
  console.log(`File entries: ${[...formData.entries()].filter(([k,v]) => v instanceof Blob).length}`);
  
  try {
    // Need to get admin session cookie first - skip auth for now by using a direct fetch
    // Note: This will fail with 401 if not authenticated. That's OK - we just want to see
    // if multer receives the file.
    const response = await fetch(`http://localhost:3000/admin/products/edit/${product._id}`, {
      method: 'PUT',
      body: formData,
      redirect: 'manual'  // Don't follow redirects
    });
    
    console.log(`\nResponse status: ${response.status}`);
    const text = await response.text();
    try {
      const json = JSON.parse(text);
      console.log('Response:', JSON.stringify(json, null, 2));
    } catch {
      console.log('Response (not JSON):', text.substring(0, 200));
    }
  } catch (err) {
    console.error('Fetch error:', err.message);
  }
  
  // Check variant images after
  const updatedVariant = await Variant.findById(variant._id);
  console.log(`\nVariant images after: ${updatedVariant.images.length}`);
  
  await mongoose.disconnect();
}

main().catch(console.error);
