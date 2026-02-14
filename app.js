import express from "express";
import experssLayouts from "express-ejs-layouts";
import path from "path";
import { fileURLToPath } from "url";
import userRoutes from "./routes/userRoutes.js"
import adminRoutes from "./routes/adminRoutes.js"
import session from "express-session";
import morgan from "morgan";
import dotenv from "dotenv";
dotenv.config();

 
const app=express()
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(morgan("dev"))
app.use(express.json())
app.use(express.urlencoded({extended:true}))
app.use(express.static(path.join(__dirname, "public")));
app.set("view engine","ejs")
app.set("views",path.join(__dirname, "views"))
app.use(experssLayouts)


app.use(
  session({
    name: "neo_luxe_session",
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 24 * 60 * 60 * 1000,
    },
  })
);


app.use("/", userRoutes);
app.use("/admin",adminRoutes);






export default app;