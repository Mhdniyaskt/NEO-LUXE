import multer from "multer";
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import cloudinary from '../config/cloudinary.config.js';
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB per file
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files allowed"), false);
    }
  }
});



const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'neo-luxe-watches',
        allowed_formats: ['jpg', 'png', 'jpeg', 'webp'],
    },
});

export const upload2 = multer({ storage: storage });