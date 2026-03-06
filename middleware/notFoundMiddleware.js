import AppError from "../utils/appError.js";
import { HTTP_STATUS } from "../constants/httpStatus.js";

const notFoundHandler = (req,res,next)=>{

    // Ignore errors when opening inspect
    if (req.originalUrl.startsWith("/.well-known")) {
    return res.sendStatus(404);
  }

    next(new AppError(`Cannot Find ${req.originalUrl}`,HTTP_STATUS.NOT_FOUND));
};

export default notFoundHandler;