const { v2: cloudinary } = require("cloudinary");

// Trade screenshots previously lived on the backend's own local disk
// (multer.diskStorage, "uploads/"), which is ephemeral on Render's free
// tier -- wiped on every restart/deploy, which this app does constantly
// (auto-deploy on every push to main). The database only ever stored a
// *reference* (screenshot.url) to a file, not the image itself, so nearly
// every trade's screenshot was silently gone from disk long before anyone
// went looking for it. Cloudinary's free tier is genuinely persistent
// storage, so this is the actual fix, not a workaround.
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

module.exports = cloudinary;
