import express from "express";
import passport from "passport";
import { googleCallback } from "../controllers/user/googleAuthController.js";
import { noCache } from "../middleware/cache.middleware.js";
const router = express.Router();

router.get(
  "/google",
  noCache,
  passport.authenticate("google", { scope: ["profile", "email"] ,prompt: "select_account"})
);

router.get(
  "/google/callback",
  noCache,
  passport.authenticate("google", {
    session: false,
    failureRedirect: "/login",
    failureFlash: true,
  }),
  googleCallback
);

export default router;