export const config = {
  api: {
    bodyParser: false,
  },
};

import formidable from "formidable";
import fs from "fs";

export default function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Only POST allowed");
  }

  const form = formidable({ multiples: true });

  form.parse(req, (err, fields, files) => {
    const targets = Array.isArray(files.targets)
      ? files.targets
      : [files.targets];

    const imagesBase64 = targets.map((f) => {
      const buf = fs.readFileSync(f.filepath);
      return "data:image/png;base64," + buf.toString("base64");
    });

    res.status(200).json({ images: imagesBase64 });
  });
}
