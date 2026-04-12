import { HTTP_STATUS } from "../constants/http-status.constant.js";

class AppError extends Error{
    constructor(message,statusCode = HTTP_STATUS.INTERNAL_SERVER_ERROR){
        super(message);
        this.statusCode = statusCode;
        this.isOperational = true;
    }
}

export default AppError;