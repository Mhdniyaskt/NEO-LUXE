export const authenticateAdmin = (req, res, next) => {
  if (req.session?.admin) {
    req.admin = req.session.admin;
  }
  next();
};

export const requireAdmin = (req, res, next) => {
  if (!req.session?.admin) {
    return res.redirect("/admin");
  }
  next();
};

export const redirectIfAdminAuthenticated = (req, res, next) => {
  if (req.session?.admin) {
    return res.redirect("/admin/dashboard");
  }
  next();
};