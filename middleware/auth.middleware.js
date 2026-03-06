export const checkUser = (req, res, next) => {

  if (req.session && req.session.user) {
    res.locals.isLoggedIn = true;
    res.locals.user = req.session.user;

    console.log("User logged in:", req.session.user.email);

  } else {
    res.locals.isLoggedIn = false;
    res.locals.user = null;
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

export const redirectIfAuthenticated = (req,res,next)=>{
    if(req.session.user){
      console.log(req.user)
        return res.redirect("/home");
    }
    next();
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
