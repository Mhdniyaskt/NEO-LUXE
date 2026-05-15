import asyncHandler from '../../utils/asyncHandler.util.js';
import { getUserReferralData } from '../../services/referral.service.js';

// ─── GET /referral ────────────────────────────────────────────────────────────
export const getReferralPage = asyncHandler(async (req, res) => {
  const userId = req.session.user.id;
  const data   = await getUserReferralData(userId);

  res.render('user/referral', {
    layout:     'layouts/user',
    path:       'referral',
    activePage: 'referral',
    ...data,
  });
});
