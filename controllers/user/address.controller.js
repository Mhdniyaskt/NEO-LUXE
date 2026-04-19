import asyncHandler from "../../utils/asyncHandler.util.js";
import {
  getUserAddressesService,
  addAddressService,
  updateAddressService,
  deleteAddressService
} from "../../services/address.service.js";



export const showAddressManagement = asyncHandler(async (req, res) => {
  const userId = req.session.user.id;
  const page = parseInt(req.query.page) || 1;
  const limit = 4;

  const result = await getUserAddressesService(userId, page, limit);

  if (!result.success) {
    return res.status(500).send(result.message);
  }

  res.render("user/address", {
    layout: "layouts/user",
    addresses: result.addresses,
    currentPage: page,
    totalPages: result.totalPages,
    path: "/profile/address"
  });
});



export const addAddress = asyncHandler(async (req, res) => {
  const userId = req.session.user.id;

  const result = await addAddressService(userId, req.body);

  if (!result.success) {
    return res.status(400).json(result);
  }

  res.status(200).json(result);
});



export const updateAddress = asyncHandler(async (req, res) => {
  const userId = req.session.user.id;
  const { addressId } = req.params;

  const result = await updateAddressService(userId, addressId, req.body);

  if (!result.success) {
    return res.status(404).json(result);
  }

  res.status(200).json(result);
});



export const deleteAddress = asyncHandler(async (req, res) => {
  const userId = req.session.user.id;
  const { addressId } = req.params;

  const result = await deleteAddressService(userId, addressId);

  if (!result.success) {
    return res.status(404).json(result);
  }

  res.status(200).json(result);
});