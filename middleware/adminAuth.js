export const isAdmin = (req, res, next) => {
    if (req.session.admin) {
       
        next();
    } else {
        
        res.redirect("/admin/login");
    }
};



export const isLogout = (req, res, next) => {
    if (req.session.admin) {
        res.redirect("/admin/dashboard"); // Admin is already logged in, skip the login page
    } else {
        next();
    }
};