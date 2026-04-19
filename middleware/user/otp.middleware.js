export const requireOtpSession = (req, res, next) => {
    const hasUser = req.session && req.session.user;
    const hasOtpSession = req.session && req.session.otpPurpose && req.session.email;

    // 1. If they have NO OTP session active, they shouldn't be here
    if (!hasOtpSession) {
        // If they are logged in, send home. If not, send to login.
        return hasUser ? res.redirect("/") : res.redirect("/login");
    }

    // 2. If they ARE logged in, we ONLY let them stay if the purpose is NOT SIGNUP
    // (Because a logged-in user shouldn't be doing a Signup OTP)
    if (hasUser && req.session.otpPurpose === "SIGNUP") {
        return res.redirect("/");
    }

    // Otherwise, let them proceed to verify the OTP
    next();
};
