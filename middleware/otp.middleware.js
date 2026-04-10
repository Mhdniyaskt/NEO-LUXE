export const requireOtpSession = (req, res, next) => {
    // 1. If user is already fully logged in, send to home/profile
    if (req.session && req.session.user) {
        return res.redirect("/home");
    }

    // 2. Check for the temporary data you set during signup (e.g., tempUser or otpEmail)
    // Adjust 'userData' to whatever key you use in handleSignup
    if (!req.session.userData) { 
        return res.redirect("/signup");
    }

    next();
};
