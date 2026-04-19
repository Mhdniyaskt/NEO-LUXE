import express from "express";
import passport from "passport";
import { noCache } from "../middleware/user/nocache.middleware.js";
import { redirectIfAuthenticated } from "../middleware/user/auth.middleware.js";

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
  (req, res, next) => {
    passport.authenticate("google", { session: false }, (err, user, info) => {
      if (err) return next(err);
      if (!user) {
        const reason = info?.reason || "failed";
        return res.redirect(`/login?error=${reason}`);
      }

      // Manually set the session
      req.session.user = {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      };

   req.session.save((err) => {
    if (err) return next(err);
    
    // Instead of just redirecting, we send a tiny script 
    // that REPLACES the history entry.
    res.send(`
        <script>
            // This replaces the Google Sign-in page in history 
            // with your Home page. Now 'Back' skips Google entirely.
            window.location.replace("/");
        </script>
    `);
});
    })(req, res, next);
  }
);


export default router;