import passport from "passport";

export const googleAuthCallback = (req, res, next) => {
    // We use a custom callback to handle Passport info (like 'blocked' or 'admin_denied')
    passport.authenticate("google", { session: false }, (err, user, info) => {
        if (err) return next(err);
        
        if (!user) {
            const reason = info?.reason || "failed";
            return res.redirect(`/login?error=${reason}`);
        }

        // 1. Manually set the session with ALL database fields
        // This ensures Google users have the same object structure as normal users
        req.session.user = {
            id: user._id,
            name: user.name,
            email: user.email,
            phone: user.phone || "", 
            role: user.role,
            profilePhoto: user.profilePhoto || null,
            googleId: user.googleId
        };

        // 2. Save session to the store (MongoDB/Redis)
        req.session.save((err) => {
            if (err) {
                console.error("Session Save Error:", err);
                return next(err);
            }
            
            // 3. Prevent back-button loops by replacing history
            res.send(`
                <script>
                    window.location.replace("/");
                </script>
            `);
        });
    })(req, res, next);
};