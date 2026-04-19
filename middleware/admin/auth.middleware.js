export const isAdmin = (req, res, next) => {
  if (req.session && req.session.admin) {
    return next();
  }

  res.set({
    "Cache-Control": "no-store"
  });

  return res.redirect("/admin/login");
};



export const isLogout = (req, res, next) => {
    if (req.session.admin) {
        res.redirect("/admin/dashboard"); 
    } else {
        next();
    }
};