import User from "../models/User.model.js";

export const ensureNotBlocked = async (req, res, next) => {
  try {
    if (!req.user) {
      return next();
    }

    const user = await User.findById(req.user.userId);

    if (!user || user.isBlocked) {
      res.clearCookie("accessToken");
      res.clearCookie("refreshToken");
      return res.redirect("/login");
    }

    next();
  } catch (error) {
    res.clearCookie("accessToken");
    res.redirect("/login");
  }
};