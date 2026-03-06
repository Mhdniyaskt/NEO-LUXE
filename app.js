import express from "express";
import experssLayouts from "express-ejs-layouts";
import path from "path";
import { fileURLToPath } from "url";
import userRoutes from "./routes/userRoutes.js"
import adminRoutes from "./routes/adminRoutes.js"
import googleAuthRoutes from "./routes/googleAuthRoute.js"
import session from "express-session";
 import passport from "./config/passport.js";
import morgan from "morgan";
import dotenv from "dotenv";
import { checkUser} from "./middleware/auth.middleware.js";

import methodOverride from 'method-override';

// ... after other app.use calls

dotenv.config();

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. Basic Parsers
app.use(morgan("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));


// 2. Session Configuration
app.use(
  session({
    name: "neo_luxe_session",
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      // FIX: If you're on localhost, 'secure' must be false even if NODE_ENV is production
      secure: false, 
      sameSite: "lax",
      maxAge: 24 * 60 * 60 * 1000,
    },
  })
);
app.use(passport.session());
app.use(checkUser);
app.use(methodOverride('_method'));
// 4. Static Files & View Engine
app.use(express.static(path.join(__dirname, "public")));
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(experssLayouts);
 app.use(passport.initialize());
// 5. Routes
app.use("/", userRoutes);
app.use("/admin", adminRoutes);
app.use("/auth",googleAuthRoutes);

export default app;