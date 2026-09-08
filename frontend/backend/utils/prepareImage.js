const sharp = require("sharp");

// A phone screenshot uploaded as-is (often several MB, thousands of pixels
// per side) was going to Gemini completely unresized -- more pixels than
// the model gets any analysis benefit from, but directly adding to upload
// time and Gemini's own processing time. That's the likely cause of
// screenshot analysis "loading for a long time" before eventually failing:
// combined with the Gemini SDK call having no timeout configured at all
// (see geminiVision.js), a slow-but-not-dead request could hang far longer
// than a user would ever wait for a chart analysis. 1568px is Google's own
// documented threshold beyond which Gemini's vision input stops gaining
// resolution benefit, so this caps well above what the model can use while
// cutting a typical multi-MB screenshot down to a few hundred KB.
const MAX_DIMENSION = 1568;

async function prepareImage(buffer) {
  const resized = await sharp(buffer)
    .rotate() // apply EXIF orientation before resizing, then strip it
    .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer();

  return { base64: resized.toString("base64"), mimeType: "image/jpeg" };
}

module.exports = { prepareImage };
