import mongoose from "mongoose";

const databaseBucketName = "vybeMedia";

export const getMedia = async (req, res) => {
  try {
    const { mediaId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(mediaId)) {
      return res.status(400).json({ message: "Invalid media id" });
    }

    if (!mongoose.connection.db) {
      return res.status(503).json({ message: "Media storage is not ready" });
    }

    const fileId = new mongoose.Types.ObjectId(mediaId);
    const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
      bucketName: databaseBucketName,
    });
    const files = await bucket.find({ _id: fileId }).limit(1).toArray();
    const file = files[0];

    if (!file) {
      return res.status(404).json({ message: "Media not found" });
    }

    res.setHeader("Content-Type", file.contentType || "application/octet-stream");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");

    const downloadStream = bucket.openDownloadStream(fileId);
    downloadStream.once("error", () => {
      if (!res.headersSent) {
        res.status(404).json({ message: "Media not found" });
      } else {
        res.end();
      }
    });
    downloadStream.pipe(res);
  } catch (error) {
    return res.status(500).json({ message: `media error ${error.message}` });
  }
};
