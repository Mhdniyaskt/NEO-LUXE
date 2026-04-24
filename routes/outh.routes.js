import express from "express";
import passport from "passport";
import { noCache } from "../middleware/nocache.middleware.js";
import { redirectIfAuthenticated } from "../middleware/auth.middleware.js";
import { googleAuthCallback } from "../controllers/user/oauth.controller.js";

const router = express.Router();



// routes/auth.router.js

router.get(
  "/google",
  noCache, 
  redirectIfAuthenticated, // This stops logged-in users from starting the flow
  passport.authenticate("google", {
    scope: ["profile", "email"],
    
  })
);

router.get(
    "/google/callback",
    noCache,
    googleAuthCallback
);


export default router;