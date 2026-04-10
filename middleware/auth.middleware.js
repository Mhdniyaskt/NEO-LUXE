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


export const silentRefresh = async (req, res, next) => {
  const accessToken = req.cookies?.accessToken;
  const refreshToken = req.cookies?.refreshToken;

  // move to next if accessToken exist
  if (accessToken) return next();
  // move to next if no refreshToken
  if (!refreshToken) return next();

  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);

    const user = await User.findById(decoded.userId);

    if (!user || user.isBlocked) {
      res.clearCookie("accessToken");
      res.clearCookie("refreshToken");
      return next();
    }

    const newAccessToken = generateAccessToken(user);

    res.cookie("accessToken", newAccessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 15 * 60 * 1000,
    });

    //Attach user immediately
    req.user = { userId: user._id, role: user.role };
  } catch (error) {
    res.clearCookie("accessToken");
    res.clearCookie("refreshToken");
  }
  next();
};
