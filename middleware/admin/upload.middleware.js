import multer from 'multer';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import cloudinary from '../../config/cloudinary.config.js';

const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'neo-luxe-watches',
        allowed_formats: ['jpg', 'png', 'jpeg', 'webp'],
    },
});

export const upload = multer({ storage: storage });