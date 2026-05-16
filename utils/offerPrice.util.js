/**
 * Calculate the effective offer price for a variant.
 * Compares product-level offer (on variant) vs category-level offer.
 * Applies the LARGER percentage discount.
 *
 * @param {Object} variant - Variant document (with offerPercentage, offerExpiryDate, basePrice, regularPrice)
 * @param {Object} category - Category document (with offerPercentage, offerExpiryDate)
 * @returns {Object} { finalPrice, offerPercentage, offerSource, regularPrice, basePrice }
 */
export function calculateOfferPrice(variant, category = null) {
  const now = new Date();
  const regularPrice = variant.regularPrice || variant.basePrice;
  const basePrice    = variant.basePrice; // manually set sale price

  // Product-specific offer (on variant)
  let productOffer = 0;
  if (variant.offerPercentage > 0 && variant.offerExpiryDate && new Date(variant.offerExpiryDate) > now) {
    productOffer = variant.offerPercentage;
  }

  // Category offer
  let categoryOffer = 0;
  if (category && category.offerPercentage > 0 && category.offerExpiryDate && new Date(category.offerExpiryDate) > now) {
    categoryOffer = category.offerPercentage;
  }

  // Apply the LARGER offer
  const bestOffer = Math.max(productOffer, categoryOffer);
  const offerSource = bestOffer === 0 ? 'none'
    : (productOffer >= categoryOffer ? 'product' : 'category');

  // Calculate final price: apply offer % on regularPrice (MRP)
  let finalPrice = basePrice; // default to sale price
  if (bestOffer > 0) {
    const offerPrice = Math.round(regularPrice * (1 - bestOffer / 100));
    // Use the lower of: manual sale price OR offer-calculated price
    finalPrice = Math.min(basePrice, offerPrice);
  }

  return {
    finalPrice,
    offerPercentage: bestOffer,
    offerSource,
    regularPrice,
    basePrice,
    productOffer,
    categoryOffer,
  };
}
