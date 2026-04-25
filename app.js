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


dotenv.config();

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


app.use(morgan("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    name: "neo_luxe_session",
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      maxAge: 24 * 60 * 60 * 1000,
    },
  }),
);
app.use(passport.initialize());
app.use(passport.session());
app.use(checkUser);
app.use(methodOverride("_method"));

// Inject cart item count into every response for logged-in users
app.use(async (req, res, next) => {
  res.locals.cartCount = 0;
  if (req.session?.user?.id) {
    try {
      const cart = await Cart.findOne({ user: req.session.user.id }).lean();
      if (cart) {
        res.locals.cartCount = cart.items.reduce((sum, i) => sum + i.quantity, 0);
      }
    } catch { /* non-fatal — badge just shows 0 */ }
  }
  next();
});

app.use(express.static(path.join(__dirname, "public")));

// Serve placeholder-watch.jpg requests with the SVG fallback
app.get("/images/placeholder-watch.jpg", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "images", "placeholder-watch.svg"));
});
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(expressLayouts);


app.use("/admin", adminRoutes);
app.use("/auth", googleAuthRoutes);
app.use("/", userRoutes);

export default app;
