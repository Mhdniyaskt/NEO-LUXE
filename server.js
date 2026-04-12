import app from "./app.js";
import dotenv from "dotenv";
dotenv.config();
import connectDB from "./config/database.config.js";

connectDB();

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
