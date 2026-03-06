export const requireOtpSession = (req, res, next) => {
  if (!req.session.email) {
    console.log(req.session.email)
    return res.redirect("/signup");
  }
  next();
};