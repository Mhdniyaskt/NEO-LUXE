import dotenv from "dotenv";
dotenv.config();

import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import User from "../models/userModel.js";

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: "/auth/google/callback",
    },

    async (accessToken, refreshToken, profile, done) => {
      try {
        const email = profile.emails?.[0]?.value;

        if (!email) {
          return done(null, false, {
            message: "Google account does not have an email",
          });
        }

        let user = await User.findOne({ email });

        // Blocked user
        if (user && user.isBlocked) {
          return done(null, false, {
            message: "Your account is blocked",
          });
        }

        // Prevent admin login
        if (user && user.role === "admin") {
          return done(null, false, {
            message: "Access Denied. Use Admin Login",
          });
        }

        // Existing user but not linked with Google
        if (user && !user.googleId) {
          user.googleId = profile.id;
          user.isVerified = true;
          await user.save();

          return done(null, user);
        }

        // Create new user
        if (!user) {
          user = await User.create({
            name: profile.displayName,
            email,
            googleId: profile.id,
            isVerified: true,
          });
        }

        return done(null, user);
      } catch (error) {
        return done(error, null);
      }
    }
  )
);

// Session handling
passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (error) {
    done(error, null);
  }
});

export default passport;