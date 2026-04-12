import express from "express";
import passport from "passport";
import { noCache } from "../middleware/user/cache.middleware.js";

const router = express.Router();





router.get(
  "/google",
  noCache,
  passport.authenticate("google", {
    scope: ["profile", "email"],
    prompt: "select_account",
  })
);



router
  .route("/google/callback")
  .get(noCache, (req, res, next) => {
    passport.authenticate(
      "google",
      { session: false },
      (err, user, info) => {
        if (err) return next(err);

       
        if (!user) {
          const reason = info?.reason || "failed";
          return res.redirect(`/login?error=${reason}`);
        }

        req.session.user = {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          profilePhoto: user.profilePhoto,
        };

        req.session.save((err) => {
          if (err) return next(err);
          res.redirect("/");
        });
      }
    )(req, res, next);
  });

export default router;