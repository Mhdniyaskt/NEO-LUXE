import User from "../../models/userModel.js"
import cloudinary from "../../config/cloudinary.js";
import asyncHandler from "../../utils/asyncHandler.js";

export const showProfile =  (req, res) => {
    const user = res.locals.user;
   if (!user) {
      return res.redirect("/login");
    }
   
    return res.render("user/myProfile", { layout: "layouts/user" });
};

export const showEditProfile =  (req, res) => {
  const user = res.locals.user;

    if (!user) {
      return res.redirect("/login");
    }

    return res.render("user/edit-profile");

};
export const updateProfile = asyncHandler(async (req, res) => {
  const userId = req.user.userId;
  const { name, phone } = req.body;

    if (!name || !/^[A-Za-z ]+$/.test(name)) {
      req.flash("error", "Name can only contain letters and spaces");
      return res.redirect("/profile/edit");
    }

    if (name.trim().length > 30 || name.trim().length < 3) {
      req.flash("error", "Name should be between 3-30 characters");
      return res.redirect("/profile/edit");
    }

    const phoneRegex = /^[6-9]\d{9}$/;
    if (!phoneRegex.test(phone)) {
      req.flash("error", "Please enter a valid Phone Number");
      return res.redirect("/profile/edit");
    }

    await User.findByIdAndUpdate(userId, {
      name: name.trim(),
      phone: phone?.trim(),
    });
    req.flash("success", "Profile updated successfully");
    return res.redirect("/profile");

});


export const uploadProfilePhoto = asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      message: "Please select an image"
    });
  }

  // Use req.session.user._id or req.user.id depending on your auth middleware
  const userId = req.session.user?._id || req.user?._id;
  const user = await User.findById(userId);

  if (!user) {
    return res.status(404).json({ success: false, message: "User not found" });
  }

  // 1. Remove old image from Cloudinary if it exists
  if (user.profileImage?.public_id) {
    await cloudinary.uploader.destroy(user.profileImage.public_id);
  }

  // 2. Upload new image using the buffer
  const base64Image = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;
  
  const result = await cloudinary.uploader.upload(base64Image, {
    folder: "neoluxe/profile",
    transformation: [
      { width: 300, height: 300, crop: "fill", gravity: "face" }
    ]
  });

  // 3. Update Database
  user.profileImage = {
    url: result.secure_url,
    public_id: result.public_id
  };

  await user.save();

  res.json({
    success: true,
    message: "Profile photo updated successfully",
    imageUrl: result.secure_url
  });
});

// Remove profile photo
export const removeProfilePhoto = asyncHandler(async (req, res) => {
   
  const user = await User.findById(req.user.userId);

    // If no image exists
    if (!user.profileImage?.public_id) {
      req.flash("error", "No profile photo to remove");
      return res.redirect("/profile");
    }

    // Remove from Cloudinary
    await cloudinary.uploader.destroy(user.profileImage.public_id);

    // Remove from DB
    user.profileImage = null;
    await user.save();

    req.flash("success", "Profile photo removed");
    res.redirect("/profile");

    });