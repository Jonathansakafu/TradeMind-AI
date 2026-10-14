// Chart pictures for signals and trades (added 2026-10-14): the signal
// chart (chartAnnotations) drawn on the server (chartImage) and stored on
// Cloudinary, one picture per signal (and one for its result) and per
// trade -- re-making one overwrites it, nothing is duplicated.
const cloudinary = require("../config/cloudinary");
const chartAnnotations = require("./chartAnnotations");
const chartImage = require("./chartImage");
const Notification = require("../models/Notification");

const configured = () => !!(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY);

function upload(buffer, { folder, publicId }) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, public_id: publicId, overwrite: true, invalidate: true, resource_type: "image", format: "png" },
      (err, res) => (err ? reject(err) : resolve(res))
    );
    stream.end(buffer);
  });
}

exports.withTimeout = (p, ms) => Promise.race([p, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);

// Picture of a signal (result: after it hit TP / SL). Returns the URL or null.
exports.forNotification = async (n, { result = false } = {}) => {
  if (!configured() || !n || !["buy", "sell"].includes(n.signal) || !(n.entry > 0) || n.type === "quick_trade") return null;
  const data = await chartAnnotations.build(n.user, { notificationId: n._id, tf: "1h" });
  if (data.error) return null;
  const res = await upload(chartImage.render(data), { folder: "trademind/signal-charts", publicId: `${n._id}${result ? "-result" : ""}` });
  await Notification.updateOne({ _id: n._id }, { [result ? "resultChartImage" : "chartImage"]: res.secure_url }).catch(() => {});
  return res.secure_url;
};

// Picture of a trade, to use as its screenshot. Returns { url, publicId } or null.
exports.forTrade = async (t) => {
  if (!configured() || !t?.entryPrice) return null;
  const data = await chartAnnotations.build(t.user, { tradeId: t._id, tf: "1h" });
  if (data.error) return null;
  const res = await upload(chartImage.render(data), { folder: "trademind/trade-screenshots", publicId: `chart-${t._id}` });
  return { url: res.secure_url, publicId: res.public_id };
};
