import asyncHandler from "../../utils/asyncHandler.util.js";
import {
  getUserAddressesService,
  addAddressService,
  updateAddressService,
  setDefaultAddressService,
  deleteAddressService,
} from "../../services/address.service.js";

// ─── Shared validation ────────────────────────────────────────────────────────
function validateAddressBody(data) {
  const errors = {};
  const { fullName, phone, streetAddress, city, state, pincode } = data;

  if (!fullName || !fullName.trim())
    errors.fullName = "Full name is required";
  else if (!/^[a-zA-Z\s.'-]{2,60}$/.test(fullName.trim()))
    errors.fullName = "Name must be 2–60 letters only";

  if (!phone || !/^\d{10}$/.test(phone.trim()))
    errors.phone = "Enter a valid 10-digit mobile number";

  if (!streetAddress || !streetAddress.trim())
    errors.streetAddress = "Street address is required";
  else if (streetAddress.trim().length < 5)
    errors.streetAddress = "Address must be at least 5 characters";

  if (!city || !city.trim())
    errors.city = "City is required";
  else if (!/^[a-zA-Z\s.'-]{2,50}$/.test(city.trim()))
    errors.city = "Enter a valid city name";

  if (!state || !state.trim())
    errors.state = "State is required";
  else if (!/^[a-zA-Z\s.'-]{2,50}$/.test(state.trim()))
    errors.state = "Enter a valid state name";

  if (!pincode || !/^\d{6}$/.test(pincode.trim()))
    errors.pincode = "Enter a valid 6-digit pincode";

  return errors;
}

// ─── GET /addresses ───────────────────────────────────────────────────────────
export const showAddressManagement = asyncHandler(async (req, res) => {
  const userId = req.session.user.id;
  const page   = parseInt(req.query.page) || 1;
  const limit  = 4;

  const result = await getUserAddressesService(userId, page, limit);

  if (!result.success) {
    return res.status(500).send(result.message);
  }

  res.render("user/Address", {
    layout:      "layouts/user",
    addresses:   result.addresses,
    currentPage: page,
    totalPages:  result.totalPages,
    path:        "/addresses",
  });
});

// ─── POST /addresses ──────────────────────────────────────────────────────────
export const addAddress = asyncHandler(async (req, res) => {
  const userId = req.session.user.id;

  const errors = validateAddressBody(req.body);
  if (Object.keys(errors).length > 0) {
    return res.status(400).json({ success: false, errors });
  }

  const result = await addAddressService(userId, req.body);
  return res.status(result.success ? 200 : 400).json(result);
});

// ─── PUT /addresses/:addressId ────────────────────────────────────────────────
export const updateAddress = asyncHandler(async (req, res) => {
  const userId    = req.session.user.id;
  const { addressId } = req.params;

  const errors = validateAddressBody(req.body);
  if (Object.keys(errors).length > 0) {
    return res.status(400).json({ success: false, errors });
  }

  const result = await updateAddressService(userId, addressId, req.body);
  return res.status(result.success ? 200 : 404).json(result);
});

// ─── PATCH /addresses/:addressId/default ─────────────────────────────────────
export const setDefaultAddress = asyncHandler(async (req, res) => {
  const userId    = req.session.user.id;
  const { addressId } = req.params;

  const result = await setDefaultAddressService(userId, addressId);
  return res.status(result.success ? 200 : 404).json(result);
});

// ─── DELETE /addresses/:addressId ─────────────────────────────────────────────
export const deleteAddress = asyncHandler(async (req, res) => {
  const userId    = req.session.user.id;
  const { addressId } = req.params;

  const result = await deleteAddressService(userId, addressId);
  return res.status(result.success ? 200 : 404).json(result);
});
