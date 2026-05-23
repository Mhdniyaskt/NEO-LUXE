import dotenv from "dotenv";
dotenv.config();
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import User from "../models/user.model.js";

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      
      callbackURL: process.env.GOOGLE_CALLBACK_URL || "https://neo-luxe.niyaskt.online/auth/google/callback",
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const email = profile.emails?.[0]?.value;
        if (!email) return done(null, false, { reason: "no_email" });

        let user = await User.findOne({ email });

        if (user) {
          if (user.isBlocked) return done(null, false, { reason: "blocked" });
          if (user.role === "admin") return done(null, false, { reason: "admin_denied" });

          // Link Google ID if not already linked
          if (!user.googleId) {
            user.googleId = profile.id;
            user.isEmailVerified = true;
            await user.save();
          }
        } else {
          // New User Creation
          user = await User.create({
            name: profile.displayName,
            email,
            googleId: profile.id,
            isEmailVerified: true,
          });
        }

        return done(null, user);
      } catch (error) {
        return done(error, null);
      }
    }
  )
);

// Boilerplate for Passport
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

export default passport;