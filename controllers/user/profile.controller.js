import User from "../../models/user.model.js"
import cloudinary from "../../config/cloudinary.config.js";
import asyncHandler from "../../utils/asyncHandler.util.js";

export const showProfile = (req, res) => {
    const user = res.locals.user;
   
    if (!user) {
        return res.redirect("/login");
    }
    console.log(user);
    res.locals.activePage = 'profile';
    return res.render("user/profile-page", { 
        layout: "layouts/user",
        user: user,
        path: '/profile',
    });
};

export const showEditProfile = (req, res) => {
    const user = res.locals.user;

    if (!user) {
        return res.redirect("/login");
    }

    res.locals.activePage = 'profile';
    return res.render("user/edit-profile", { 
        layout: "layouts/user",
        user: user,
        title: "Edit Profile | NEO-LUXE",
        path: '/profile'
    });
};
export const updateProfile = asyncHandler(async (req, res) => {
    const userId = req.session?.user?.id || res.locals.user?.id;

    if (!userId) {
        return res.status(401).json({ error: "User session expired. Please login again." });
    }

    const { name, phone } = req.body;

    // 1. Validation: Name
    if (!name || !/^[A-Za-z\s]+$/.test(name)) {
        return res.status(400).json({ error: "Name can only contain letters and spaces" });
    }

    const trimmedName = name.trim();
    if (trimmedName.length < 3 || trimmedName.length > 30) {
        return res.status(400).json({ error: "Name should be between 3-30 characters" });
    }

    // 2. Validation: Phone
    const phoneRegex = /^[6-9]\d{9}$/;
    if (phone && !phoneRegex.test(phone)) {
        return res.status(400).json({ error: "Please enter a valid 10-digit Phone Number" });
    }

    // 3. Update Database
    // We use findByIdAndUpdate which works for both normal and Google users
    const updatedUser = await User.findByIdAndUpdate(
        userId,
        {
            $set: {
                name: trimmedName,
                phone: phone ? phone.trim() : ""
            }
        },
        { new: true, runValidators: true }
    );

    if (!updatedUser) {
        return res.status(404).json({ error: "User not found" });
    }

    // 4. Update the Session data
    // We spread the existing session user and overwrite only name and phone
    // This preserves googleId if it exists
    if (req.session.user) {
        req.session.user = {
            ...req.session.user,
            name: updatedUser.name,
            phone: updatedUser.phone
        };
    }

    // 5. Explicitly save session
    req.session.save((err) => {
        if (err) {
            return res.status(500).json({ error: "Failed to sync session" });
        }

        return res.status(200).json({ 
            message: "Profile updated successfully!",
            user: { 
                name: updatedUser.name, 
                phone: updatedUser.phone,
                isGoogleUser: !!updatedUser.googleId 
            }
        });
    });
});
export const uploadProfilePhoto = asyncHandler(async (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, message: "No file uploaded" });

    const userId = req.user?._id || req.session?.user?.id || req.session?.user?._id;

    try {
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ success: false, message: "User not found" });

        // Cleanup old image if it exists
        if (user.profilePhoto && user.profilePhoto.public_id) {
            await cloudinary.uploader.destroy(user.profilePhoto.public_id).catch(() => null);
        }

        // Upload new to Cloudinary
        const base64Image = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;
        const result = await cloudinary.uploader.upload(base64Image, {
            folder: "neoluxe/profile",
            transformation: [{ width: 300, height: 300, crop: "fill", gravity: "face" }]
        });

        // SAVE TO MODEL FIELD: profilePhoto
        user.profilePhoto = {
            url: result.secure_url,
            public_id: result.public_id
        };

        await user.save();

        // Update session so sidebars refresh without relogging
        if (req.session.user) {
            req.session.user.profilePhoto = user.profilePhoto;
        }

        res.json({ success: true, imageUrl: result.secure_url });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

export const removeProfilePhoto = asyncHandler(async (req, res) => {
    const userId = req.user?._id || req.session?.user?.id || req.session?.user?._id;
    const user = await User.findById(userId);

    if (user?.profilePhoto?.public_id) {
        await cloudinary.uploader.destroy(user.profilePhoto.public_id);
    }

    user.profilePhoto = undefined; 
    await user.save();

    if (req.session.user) req.session.user.profilePhoto = undefined;

    res.json({ success: true });
});