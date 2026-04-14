const mongoose = require("mongoose");

const connectDB = async (retries = 5) => {
  for (let i = 1; i <= retries; i++) {
    try {
      console.log(`MongoDB connection attempt ${i}/${retries}...`);
      console.log("URI prefix:", (process.env.MONGODB_URI || "NOT SET").substring(0, 30) + "...");
      await mongoose.connect(process.env.MONGODB_URI, {
        serverSelectionTimeoutMS: 10000,
        connectTimeoutMS: 10000,
      });
      console.log("MongoDB connected:", mongoose.connection.db.databaseName);
      return;
    } catch (err) {
      console.error(`MongoDB connection attempt ${i} failed:`, err.message);
      if (i < retries) {
        console.log(`Retrying in 3 seconds...`);
        await new Promise(r => setTimeout(r, 3000));
      } else {
        console.error("All MongoDB connection attempts failed. Exiting.");
        process.exit(1);
      }
    }
  }
};

module.exports = connectDB;
