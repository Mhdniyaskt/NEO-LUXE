export const requireOtpSession = (req, res, next) => {
    // 1. If user is already fully logged in, send to home/profile
    if (req.session && req.session.user) {
        return res.redirect("/home");
    }

  

    next();
};
