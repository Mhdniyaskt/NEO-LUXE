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
    return res.status(400).json({ success: false, message: "No file uploaded" });
  }

  const userId = req.user?._id || req.session?.user?.id || req.session?.user?._id;
  
  if (!userId) {
    return res.status(401).json({ success: false, message: "Not authenticated" });
  }

  try {
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // 3. Delete old image from Cloudinary if it exists
    if (user.profileImage && user.profileImage.public_id) {
      try {
        await cloudinary.uploader.destroy(user.profileImage.public_id);
      } catch (clErr) {
        console.error("Cloudinary Delete Error:", clErr);
        // We continue even if delete fails to allow the new upload
      }
    }

    // 4. Check if buffer exists (MemoryStorage)
    if (!req.file.buffer) {
       throw new Error("File buffer is missing. Check if Multer is using memoryStorage.");
    }

    // 5. Upload new image
    const base64Image = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;
    
    const result = await cloudinary.uploader.upload(base64Image, {
      folder: "neoluxe/profile",
      transformation: [
        { width: 300, height: 300, crop: "fill", gravity: "face" }
      ]
    });

    // 6. Update Database
    user.profilePhoto = {
      url: result.secure_url,
      public_id: result.public_id
    };

    await user.save();

    res.json({
      success: true,
      message: "Profile photo updated successfully",
      imageUrl: result.secure_url
    });

  } catch (error) {
    // THIS WILL TELL YOU THE REAL ERROR IN YOUR TERMINAL
    console.error("DETAILED UPLOAD ERROR:", error); 
    
    res.status(500).json({ 
      success: false, 
      message: error.message || "Internal Server Error" 
    });
  }
});



// Remove profile photo
export const removeProfilePhoto = asyncHandler(async (req, res) => {
    
   const userId = req.user?.id || req.user?._id || req.user?.user?.id;

    if (!userId) {
        return res.status(401).json({ 
            success: false, 
            message: "User session not found. Please log in again." 
        });
    }

    const user = await User.findById(userId);

    if (!user) {
        return res.status(404).json({ success: false, message: "User not found" });
    }

    // 1. If no image exists
    if (!user.profilePhoto?.public_id) {
        // Return JSON error for the frontend fetch request
        return res.status(400).json({ 
            success: false, 
            message: "No profile photo to remove" 
        });
    }

    // 2. Remove from Cloudinary
    await cloudinary.uploader.destroy(user.profilePhoto.public_id);

    // 3. Remove from DB
    user.profilePhoto = null; // or undefined
    await user.save();

    // 4. Send JSON Success (instead of redirect)
    res.json({ 
        success: true, 
        message: "Profile photo removed successfully" 
    });
});