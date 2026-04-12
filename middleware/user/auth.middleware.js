import userModel from "../../models/user.model.js";

export const checkUser = (req, res, next) => {
    // 1. Check if the session exists and has a user
    if (req.session && req.session.user) {
        res.locals.isLoggedIn = true;
        res.locals.user = req.session.user;
        req.user = req.session.user; 
    } else {
        res.locals.isLoggedIn = false;
        res.locals.user = null;
        req.user = null;
    }

    /** * 2. BROWSER CACHE CONTROL (The fix for your back-button issue)
     * This forces the browser to talk to the server every time the user 
     * navigates, ensuring the header accurately reflects the logout state.
     */
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate'); // HTTP 1.1
    res.setHeader('Pragma', 'no-cache'); // HTTP 1.0
    res.setHeader('Expires', '0'); // Proxies

    next();
};

export const redirectIfAuthenticated = (req, res, next) => {
    if (req.session && req.session.user) {
        // Logged in users cannot see Login/Signup/Verify-OTP
        return res.redirect("/");
    }
    next();
};





export const requireAuth = (req,res,next)=>{
    if(req.session.user){
        return next();
    }else{
        return res.redirect("/login");
    }
}


export const checkUserStatus = async (req, res, next) => {
  if (!req.session.user) return next();

  // IMPORTANT: Skip this check if the logged-in person is an admin
  // This prevents admins from accidentally blocking themselves out of the panel
  if (req.session.user.role === 'admin') return next();

  try {
    const user = await userModel.findById(req.session.user.id);

    if (!user || user.isBlocked) {
      // 1. Specifically delete only the user object from the session
      delete req.session.user;

      // 2. Save the session to commit the deletion to your store (MongoDB/Memory)
      return req.session.save((err) => {
        if (err) console.error("Session Save Error:", err);

        const isApiRequest = req.xhr || (req.headers.accept && req.headers.accept.includes('json'));

        if (isApiRequest) {
          return res.status(403).json({ 
            success: false, 
            message: "Account blocked." 
          });
        }

        // Redirect to login now that req.session.user is gone
              return res.redirect("/admin/customers?error=blocked");

      });
    }
     
        
     
    
    next();
  } catch (error) {
    console.error("Auth Middleware Error:", error);
    next();
  }
};