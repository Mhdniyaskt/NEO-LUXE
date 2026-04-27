import userModel from "../models/user.model.js";

// ─── Inject user into res.locals for every user-facing request ───────────────
export const checkUser = (req, res, next) => {
  if (req.session && req.session.user) {
    res.locals.isLoggedIn = true;
    res.locals.user = req.session.user;
    req.user = req.session.user;
  } else {
    res.locals.isLoggedIn = false;
    res.locals.user = null;
    req.user = null;
  }

  // Prevent browser from caching authenticated pages
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  next();
};

// ─── Redirect already-logged-in users away from /login, /signup ──────────────
export const redirectIfAuthenticated = (req, res, next) => {
  if (req.session && req.session.user) {
    if (req.path === '/') return next();
    return res.redirect('/');
  }
  next();
};

// ─── Protect admin routes — requires req.session.admin (admin session) ────────
export const isAdmin = (req, res, next) => {
  if (req.session && req.session.admin) {
    return next();
  }

  res.set('Cache-Control', 'no-store');
  return res.redirect('/admin/login');
};

// ─── Redirect already-logged-in admins away from /admin/login ────────────────
export const isLogout = (req, res, next) => {
  if (req.session && req.session.admin) {
    return res.redirect('/admin/dashboard');
  }
  next();
};

// ─── Protect user routes — requires req.session.user (user session) ───────────
export const requireAuth = (req, res, next) => {
  if (req.session && req.session.user) {
    return next();
  }
  return res.redirect('/login');
};

// ─── Block-check on every user request ───────────────────────────────────────
// Runs only on user routes (admin routes carry a separate session with no .user)
export const checkUserStatus = async (req, res, next) => {
  if (!req.session || !req.session.user) return next();

  try {
    const user = await userModel.findById(req.session.user.id);

    if (!user || user.isBlocked) {
      delete req.session.user;

      return req.session.save((err) => {
        if (err) console.error('Session save error:', err);

        const isApiRequest =
          req.xhr || (req.headers.accept && req.headers.accept.includes('json'));

        if (isApiRequest) {
          return res.status(403).json({
            success: false,
            message: 'Your account has been blocked.',
          });
        }

        return res.redirect('/login?error=blocked');
      });
    }

    next();
  } catch (error) {
    console.error('checkUserStatus error:', error);
    next();
  }
};
