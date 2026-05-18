/**
 * Calculate the effective offer price for a variant.
 * Compares product-level offer and category-level offer.
 * Applies the LARGER percentage discount on the SALE PRICE (basePrice).
 *
 * IMPORTANT: Offer is applied on salePrice (basePrice), NOT regularPrice.
 * The difference between regularPrice and basePrice is NOT an offer — it's just the sale price.
 *
 * @param {Object} variant - Variant document (with basePrice, regularPrice)
 * @param {Object} category - Category document (with offerPercentage, offerExpiryDate)
 * @param {Object} product - Product document (with offerPercentage, offerExpiryDate)
 * @returns {Object} { finalPrice, offerPercentage, offerSource, salePrice, regularPrice }
 */
export function calculateOfferPrice(variant, category = null, product = null) {
  const now = new Date();
  const salePrice    = variant.basePrice;      // the base selling price
  const regularPrice = variant.regularPrice || variant.basePrice;  // MRP

  // Product-level offer
  let productOffer = 0;
  if (product && product.offerPercentage > 0 && product.offerExpiryDate && new Date(product.offerExpiryDate) > now) {
    productOffer = product.offerPercentage;
  }

  // Category offer
  let categoryOffer = 0;
  if (category && category.offerPercentage > 0 && category.offerExpiryDate && new Date(category.offerExpiryDate) > now) {
    categoryOffer = category.offerPercentage;
  }

  // Apply the LARGEST active offer
  const bestOffer = Math.max(productOffer, categoryOffer);
  let offerSource = 'none';
  if (bestOffer > 0) {
    offerSource = productOffer >= categoryOffer ? 'product' : 'category';
  }

  // Calculate final price: apply offer % on SALE PRICE (basePrice)
  let finalPrice = salePrice; // default — no offer
  if (bestOffer > 0) {
    const discountAmount = Math.round(salePrice * bestOffer / 100);
    finalPrice = salePrice - discountAmount;
  }

  return {
    finalPrice,
    offerPercentage: bestOffer,   // 0 means no active offer
    offerSource,                  // 'none', 'product', or 'category'
    salePrice,                    // basePrice — the price before offer discount
    regularPrice,                 // MRP
    productOffer,
    categoryOffer,
  };
}
