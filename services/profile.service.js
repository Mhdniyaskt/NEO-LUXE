import User from '../models/user.model.js';
import bcrypt from 'bcrypt';
import { v2 as cloudinary } from 'cloudinary';
import { MESSAGES } from '../constants/messages.constant.js';

// ─── Get user profile ─────────────────────────────────────────────────────────
export const getUserProfileService = async (userId) => {
  try {
    const user = await User.findById(userId)
      .select('-password -refreshToken')
      .lean();

    if (!user) {
      return { success: false, message: MESSAGES.USER.NOT_FOUND };
    }

    return { success: true, user };
  } catch (error) {
    console.error('Get user profile service error:', error);
    return { success: false, message: MESSAGES.USER.FETCH_FAILED };
  }
};

// ─── Update user profile ──────────────────────────────────────────────────────
export const updateUserProfileService = async (userId, updateData) => {
  try {
    const { name, phoneNumber, dateOfBirth, gender } = updateData;

    // Validation
    const updates = {};

    if (name !== undefined) {
      if (!name || !name.trim()) {
        return { success: false, message: MESSAGES.VALIDATION.NAME_REQUIRED };
      }
      if (!/^[A-Za-z ]+$/.test(name.trim())) {
        return { success: false, message: MESSAGES.VALIDATION.NAME_LETTERS_SPACES };
      }
      if (name.trim().length < 2 || name.trim().length > 50) {
        return { success: false, message: MESSAGES.VALIDATION.NAME_LENGTH_PROFILE };
      }
      updates.name = name.trim();
    }

    if (phoneNumber !== undefined) {
      if (!phoneNumber || !phoneNumber.trim()) {
        return { success: false, message: MESSAGES.VALIDATION.PHONE_REQUIRED };
      }
      const phoneRegex = /^[6-9]\d{9}$/;
      if (!phoneRegex.test(phoneNumber.trim())) {
        return { success: false, message: MESSAGES.VALIDATION.PHONE_INVALID_10 };
      }
      
      // Check if phone number already exists (excluding current user)
      const existingUser = await User.findOne({
        phoneNumber: phoneNumber.trim(),
        _id: { $ne: userId }
      });
      if (existingUser) {
        return { success: false, message: MESSAGES.VALIDATION.PHONE_ALREADY_EXISTS };
      }
      
      updates.phoneNumber = phoneNumber.trim();
    }

    if (dateOfBirth !== undefined) {
      if (dateOfBirth) {
        const dob = new Date(dateOfBirth);
        if (isNaN(dob.getTime())) {
          return { success: false, message: MESSAGES.VALIDATION.DOB_INVALID };
        }
        
        // Check if user is at least 13 years old
        const today = new Date();
        const age = today.getFullYear() - dob.getFullYear();
        const monthDiff = today.getMonth() - dob.getMonth();
        if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
          age--;
        }
        
        if (age < 13) {
          return { success: false, message: MESSAGES.VALIDATION.AGE_MINIMUM };
        }
        
        updates.dateOfBirth = dob;
      } else {
        updates.dateOfBirth = null;
      }
    }

    if (gender !== undefined) {
      if (gender && !['male', 'female', 'other'].includes(gender.toLowerCase())) {
        return { success: false, message: MESSAGES.VALIDATION.GENDER_INVALID };
      }
      updates.gender = gender ? gender.toLowerCase() : null;
    }

    if (Object.keys(updates).length === 0) {
      return { success: false, message: MESSAGES.GENERIC.NO_FIELDS_TO_UPDATE };
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      updates,
      { new: true, runValidators: true }
    ).select('-password -refreshToken');

    if (!updatedUser) {
      return { success: false, message: MESSAGES.USER.NOT_FOUND };
    }

    return {
      success: true,
      message: 'Profile updated successfully',
      user: updatedUser
    };
  } catch (error) {
    console.error('Update user profile service error:', error);
    return { success: false, message: MESSAGES.USER.PROFILE_UPDATE_FAILED };
  }
};

// ─── Upload profile photo ─────────────────────────────────────────────────────
export const uploadProfilePhotoService = async (userId, imageFile) => {
  try {
    if (!imageFile) {
      return { success: false, message: MESSAGES.USER.PHOTO_REQUIRED };
    }

    // Get current user to check for existing profile photo
    const user = await User.findById(userId);
    if (!user) {
      return { success: false, message: MESSAGES.USER.NOT_FOUND };
    }

    // Delete old profile photo from Cloudinary if exists
    if (user.profilePhoto && user.profilePhoto.public_id) {
      try {
        await cloudinary.uploader.destroy(user.profilePhoto.public_id);
      } catch (deleteError) {
        console.warn('Failed to delete old profile photo:', deleteError);
      }
    }

    // Upload new photo to Cloudinary
    const uploadResult = await cloudinary.uploader.upload(imageFile.path, {
      folder: 'neo-luxe/profiles',
      transformation: [
        { width: 300, height: 300, crop: 'fill', gravity: 'face' },
        { quality: 'auto', fetch_format: 'auto' }
      ]
    });

    // Update user profile photo
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      {
        profilePhoto: {
          public_id: uploadResult.public_id,
          url: uploadResult.secure_url
        }
      },
      { new: true }
    ).select('-password -refreshToken');

    return {
      success: true,
      message: 'Profile photo updated successfully',
      profilePhoto: updatedUser.profilePhoto
    };
  } catch (error) {
    console.error('Upload profile photo service error:', error);
    return { success: false, message: MESSAGES.USER.PHOTO_UPLOAD_FAILED };
  }
};

// ─── Remove profile photo ─────────────────────────────────────────────────────
export const removeProfilePhotoService = async (userId) => {
  try {
    const user = await User.findById(userId);
    if (!user) {
      return { success: false, message: MESSAGES.USER.NOT_FOUND };
    }

    // Delete photo from Cloudinary if exists
    if (user.profilePhoto && user.profilePhoto.public_id) {
      try {
        await cloudinary.uploader.destroy(user.profilePhoto.public_id);
      } catch (deleteError) {
        console.warn('Failed to delete profile photo from Cloudinary:', deleteError);
      }
    }

    // Remove profile photo from user document
    await User.findByIdAndUpdate(
      userId,
      { $unset: { profilePhoto: 1 } }
    );

    return { success: true, message: MESSAGES.USER.PHOTO_REMOVED };
  } catch (error) {
    console.error('Remove profile photo service error:', error);
    return { success: false, message: MESSAGES.USER.PHOTO_REMOVE_FAILED };
  }
};

// ─── Change password ──────────────────────────────────────────────────────────
export const changePasswordService = async (userId, passwordData) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = passwordData;

    // Validation
    if (!currentPassword || !newPassword || !confirmPassword) {
      return { success: false, message: MESSAGES.GENERIC.ALL_FIELDS_REQUIRED };
    }

    if (newPassword !== confirmPassword) {
      return { success: false, message: MESSAGES.AUTH.PASSWORD_MISMATCH };
    }

    if (newPassword.length < 8) {
      return { success: false, message: MESSAGES.AUTH.PASSWORD_MIN_LENGTH_LONG };
    }

    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/;
    if (!passwordRegex.test(newPassword)) {
      return { 
        success: false, 
        message: 'New password must contain at least one uppercase letter, one lowercase letter, one number, and one special character' 
      };
    }

    if (currentPassword === newPassword) {
      return { success: false, message: 'New password must be different from current password' };
    }

    // Get user with password
    const user = await User.findById(userId);
    if (!user) {
      return { success: false, message: MESSAGES.USER.NOT_FOUND };
    }

    // Verify current password
    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);
    if (!isCurrentPasswordValid) {
      return { success: false, message: MESSAGES.USER.CURRENT_PASSWORD_WRONG };
    }

    // Hash new password
    const saltRounds = 12;
    const hashedNewPassword = await bcrypt.hash(newPassword, saltRounds);

    // Update password
    await User.findByIdAndUpdate(userId, { password: hashedNewPassword });

    return { success: true, message: MESSAGES.USER.PASSWORD_CHANGED };
  } catch (error) {
    console.error('Change password service error:', error);
    return { success: false, message: MESSAGES.USER.PASSWORD_CHANGE_FAILED };
  }
};

// ─── Change email (initiate process) ──────────────────────────────────────────
export const initiateEmailChangeService = async (userId, newEmail) => {
  try {
    if (!newEmail || !newEmail.trim()) {
      return { success: false, message: 'New email is required' };
    }

    const email = newEmail.trim().toLowerCase();
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return { success: false, message: 'Please enter a valid email address' };
    }

    // Check if email already exists
    const existingUser = await User.findOne({ 
      email,
      _id: { $ne: userId }
    });
    if (existingUser) {
      return { success: false, message: MESSAGES.USER.EMAIL_ALREADY_EXISTS };
    }

    // Get current user
    const user = await User.findById(userId);
    if (!user) {
      return { success: false, message: MESSAGES.USER.NOT_FOUND };
    }

    if (user.email === email) {
      return { success: false, message: MESSAGES.USER.EMAIL_SAME_AS_CURRENT };
    }

    // Store pending email change (you might want to implement OTP verification here)
    await User.findByIdAndUpdate(userId, {
      pendingEmailChange: email,
      emailChangeRequestedAt: new Date()
    });

    return { 
      success: true, 
      message: 'Email change initiated. Please verify your new email address.',
      pendingEmail: email
    };
  } catch (error) {
    console.error('Initiate email change service error:', error);
    return { success: false, message: MESSAGES.USER.EMAIL_CHANGE_FAILED };
  }
};

// ─── Confirm email change ─────────────────────────────────────────────────────
export const confirmEmailChangeService = async (userId, verificationCode) => {
  try {
    // This is a placeholder - implement actual OTP verification logic
    const user = await User.findById(userId);
    if (!user) {
      return { success: false, message: MESSAGES.USER.NOT_FOUND };
    }

    if (!user.pendingEmailChange) {
      return { success: false, message: MESSAGES.USER.EMAIL_NO_PENDING };
    }

    // Verify code (implement your OTP verification logic here)
    // For now, we'll assume verification is successful

    // Update email
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      {
        email: user.pendingEmailChange,
        $unset: { 
          pendingEmailChange: 1,
          emailChangeRequestedAt: 1
        }
      },
      { new: true }
    ).select('-password -refreshToken');

    return {
      success: true,
      message: 'Email changed successfully',
      user: updatedUser
    };
  } catch (error) {
    console.error('Confirm email change service error:', error);
    return { success: false, message: MESSAGES.USER.EMAIL_CHANGE_CONFIRM_FAILED };
  }
};

// ─── Get user statistics ──────────────────────────────────────────────────────
export const getUserStatsService = async (userId) => {
  try {
    // This would typically aggregate data from orders, wishlist, etc.
    // For now, return basic user info
    const user = await User.findById(userId)
      .select('name email phoneNumber createdAt profilePhoto')
      .lean();

    if (!user) {
      return { success: false, message: MESSAGES.USER.NOT_FOUND };
    }

    // You can add more statistics here like:
    // - Total orders
    // - Total spent
    // - Wishlist count
    // - Last login, etc.

    return {
      success: true,
      stats: {
        user,
        memberSince: user.createdAt,
        // Add more stats as needed
      }
    };
  } catch (error) {
    console.error('Get user stats service error:', error);
    return { success: false, message: MESSAGES.USER.STATS_FAILED };
  }
};