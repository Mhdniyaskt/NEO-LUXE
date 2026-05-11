import express from "express";
import expressLayouts from "express-ejs-layouts";
import path from "path";
import { fileURLToPath } from "url";
import userRoutes from "./routes/user.routes.js";
import adminRoutes from "./routes/admin.routes.js";
import googleAuthRoutes from "./routes/outh.routes.js";
import session from "express-session";
import passport from "./config/passport.config.js";
import morgan from "morgan";
import dotenv from "dotenv";
import { checkUser } from "./middleware/auth.middleware.js";
import methodOverride from "method-override";
import Cart from "./models/cart.model.js";
import Wishlist from "./models/wishlist.model.js";
import { HTTP_STATUS } from "./constants/http-status.constant.js";
import { MESSAGES } from "./constants/messages.constant.js";

dotenv.config();

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(morgan("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Admin session — only active for /admin routes ───────────────────────────
const adminSession = session({
  name: "neo_luxe_admin",
  secret: process.env.ADMIN_SESSION_SECRET || process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: false,
    sameSite: "lax",
    maxAge: 8 * 60 * 60 * 1000, // 8 hours
  },
});

// ─── User session — active for / and /auth routes ────────────────────────────
const userSession = session({
  name: "neo_luxe_user",
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: false,
    sameSite: "lax",
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
  },
});

// Mount each session only on its own prefix
app.use("/admin", adminSession);
app.use("/auth",  userSession);
app.use("/",      userSession);

app.use(passport.initialize());
app.use(passport.session());
app.use(checkUser);
app.use(methodOverride("_method"));

// Inject cart + wishlist counts into every response for logged-in users
app.use(async (req, res, next) => {
  res.locals.cartCount     = 0;
  res.locals.wishlistCount = 0;
  if (req.session?.user?.id) {
    try {
      const [cart, wishlist] = await Promise.all([
        Cart.findOne({ user: req.session.user.id }).lean(),
        Wishlist.findOne({ user: req.session.user.id }).lean(),
      ]);
      if (cart)     res.locals.cartCount     = cart.items.length;
      if (wishlist) res.locals.wishlistCount = wishlist.items.length;
    } catch { /* non-fatal */ }
  }
  next();
});

app.use(express.static(path.join(__dirname, "public")));

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(expressLayouts);

app.use("/admin", adminRoutes);
app.use("/auth",  googleAuthRoutes);
app.use("/",      userRoutes);

// ─── Global error handler ─────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err.message, "| URL:", req.url);

  // Multer / file upload errors
  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ success: false, message: MESSAGES.UPLOAD.FILE_TOO_LARGE });
  }
  if (err.message === "Only image files allowed") {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ success: false, message: MESSAGES.UPLOAD.ONLY_IMAGES });
  }

  // Cloudinary / network errors during upload
  if (err.http_code || (err.name === "Error" && err.message?.includes("cloudinary"))) {
    return res.status(HTTP_STATUS.BAD_GATEWAY).json({ success: false, message: MESSAGES.UPLOAD.CLOUDINARY_FAILED });
  }

  // Razorpay API errors — don't expose their status codes directly
  if (err.error && err.statusCode) {
    console.error('Razorpay API error:', err.error);
    return res.status(500).json({
      success: false,
      message: 'Payment gateway error. Please try again.'
    });
  }

  // Mongoose validation errors
  if (err.name === "ValidationError") {
    const messages = Object.values(err.errors).map(e => e.message).join(", ");
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ success: false, message: messages });
  }

  // Default
  const status = err.statusCode || HTTP_STATUS.INTERNAL_SERVER_ERROR;
  res.status(status).json({
    success: false,
    message: err.isOperational ? err.message : MESSAGES.GENERIC.SOMETHING_WENT_WRONG,
  });
});

export default app;