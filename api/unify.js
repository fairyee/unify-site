// api/unify.js – 업로드된 이미지를 배치 편집해 PNG dataURL로 돌려줌

export const config = {
  api: {
    bodyParser: false, // FormData 직접 파싱
  },
};

import formidable from "formidable";
import fs from "fs";
import sharp from "sharp";

function getLineColorRGB(name) {
  switch (name) {
    case "brown":
      return { r: 80, g: 50, b: 30 };
    case "navy":
      return { r: 25, g: 35, b: 80 };
    case "white":
      return { r: 245, g: 245, b: 245 };
    default:
      return null; // original
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method not allowed");
  }

  const form = formidable({ multiples: true });

  form.parse(req, async (err, fields, files) => {
    if (err) {
      console.error("Form parse error:", err);
      return res.status(500).send("Form parse error");
    }

    try {
      const doResize = fields.doResize === "1";
      const width = parseInt(fields.width || "512", 10) || 512;
      const height = parseInt(fields.height || "512", 10) || 512;
      const keepRatio = fields.keepRatio === "1";
      const fitMode = fields.fitMode || "contain";
      const makeTransparent = fields.makeTransparent === "1";

      const brightness = Number(fields.brightness || "0"); // -50 ~ 50
      const saturation = Number(fields.saturation || "0"); // -50 ~ 50
      const contrast = Number(fields.contrast || "0");     // -50 ~ 50
      const hue = Number(fields.hue || "0");               // -180 ~ 180

      const lineStrength = Number(fields.lineStrength || "0"); // -50 ~ 50
      const lineColorName = fields.lineColor || "original";
      const lineColor = getLineColorRGB(lineColorName);

      const overlayText = (fields.overlayText || "").toString();
      const textSize = parseInt(fields.textSize || "32", 10) || 32;
      const textColorName = fields.textColor || "white";
      const textPosition = fields.textPosition || "bottom";

      const textColorMap = {
        white: "#ffffff",
        black: "#000000",
        brown: "#553322",
      };
      const textColor = textColorMap[textColorName] || "#ffffff";

      // images 필드를 배열로 정규화
      const raw = files.images;
      const items = Array.isArray(raw) ? raw : [raw].filter(Boolean);

      const outImages = [];

      for (const file of items) {
        if (!file) continue;

        const inputBuffer = fs.readFileSync(file.filepath);
        let img = sharp(inputBuffer).ensureAlpha();

        // ─────────────────────────────
        // 1) 크기/비율/맞추는 방식 처리
        // ─────────────────────────────
        if (doResize) {
          let fit = "contain";
          if (fitMode === "cover") fit = "cover";
          else if (fitMode === "fill") fit = "fill";

          img = img.resize(width, height, {
            fit,
            background: { r: 0, g: 0, b: 0, alpha: 0 },
          });
        }

        // ─────────────────────────────
        // 2) 색감 & 대비 조정 (modulate + linear)
        // ─────────────────────────────
        const modBright = 1 + brightness / 100;   // 0.5 ~ 1.5
        const modSat = 1 + saturation / 100;      // 0.5 ~ 1.5
        const modHue = hue;                       // -180 ~ 180 (deg)

        img = img.modulate({
          brightness: modBright,
          saturation: modSat,
          hue: modHue,
        });

        // 대비는 linear로 간단 처리
        if (contrast !== 0) {
          const c = contrast / 100; // -0.5 ~ 0.5
          img = img.linear(1 + c, -128 * c);
        }

        // ─────────────────────────────
        // 3) raw 픽셀 접근 (배경 제거, 라인 처리)
        // ─────────────────────────────
        let { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
        const { width: w, height: h, channels } = info; // 보통 4(RGBA)

        const thresholdBg = 240; // 배경으로 볼 밝기 기준
        const thresholdLine = 90; // 선(어두운 영역)으로 볼 기준

        // 한 번 복사본 만들어서 라인 굵기 처리용으로 사용
        const buf = Buffer.from(data); // 원본 복사

        // 3-1) 배경 제거 (밝은 영역 알파 0)
        if (makeTransparent) {
          for (let i = 0; i < data.length; i += channels) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const aIndex = i + 3;

            const avg = (r + g + b) / 3;
            if (avg >= thresholdBg) {
              data[aIndex] = 0;
            }
          }
        }

        // 3-2) 라인 굵기/색 처리
        // lineStrength > 0 → 선을 더 진하게/굵게 느낌
        // lineStrength < 0 → 선을 약하게
        const doLine = lineStrength !== 0 || lineColor;
        if (doLine) {
          const strength = lineStrength / 50; // -1 ~ 1

          // 간단하게: 선 픽셀을 더 어둡게/밝게, 그리고 색 바꾸기
          for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
              const idx = (y * w + x) * channels;
              const r = data[idx];
              const g = data[idx + 1];
              const b = data[idx + 2];
              const aIndex = idx + 3;
              const a = data[aIndex];

              if (a === 0) continue; // 이미 투명한 픽셀은 패스

              const avg = (r + g + b) / 3;

              // "선"으로 보는 조건 (꽤 어두운 픽셀)
              if (avg < thresholdLine) {
                let nr = r;
                let ng = g;
                let nb = b;

                // 굵기 느낌: 더 어둡게 / 덜 어둡게
                if (strength > 0) {
                  // 진하게
                  const factor = 1 + strength * 0.8; // 최대 1.8배 정도
                  nr = Math.max(0, r / factor);
                  ng = Math.max(0, g / factor);
                  nb = Math.max(0, b / factor);
                } else if (strength < 0) {
                  // 약하게
                  const factor = 1 + (-strength) * 0.8;
                  nr = Math.min(255, r * factor);
                  ng = Math.min(255, g * factor);
                  nb = Math.min(255, b * factor);
                }

                // 선 색 변경
                if (lineColor) {
                  nr = lineColor.r;
                  ng = lineColor.g;
                  nb = lineColor.b;
                }

                data[idx] = nr;
                data[idx + 1] = ng;
                data[idx + 2] = nb;
              }
            }
          }
        }

        // raw 데이터를 다시 sharp로 감싸기
        img = sharp(data, {
          raw: {
            width: w,
            height: h,
            channels,
          },
        });

        // ─────────────────────────────
        // 4) 텍스트 추가 (SVG overlay)
        // ─────────────────────────────
        let outBuffer;
        if (overlayText && overlayText.trim().length > 0) {
          const svg = createTextSVG(w, h, overlayText, textSize, textColor, textPosition);
          const svgBuffer = Buffer.from(svg);

          outBuffer = await img
            .composite([{ input: svgBuffer, top: 0, left: 0 }])
            .png()
            .toBuffer();
        } else {
          outBuffer = await img.png().toBuffer();
        }

        const base64 = "data:image/png;base64," + outBuffer.toString("base64");
        outImages.push(base64);
      }

      return res.status(200).json({ images: outImages });
    } catch (e) {
      console.error("Processing error:", e);
      return res.status(500).send("Image processing error");
    }
  });
}

// 텍스트를 얹기 위한 SVG 생성 함수
function createTextSVG(width, height, text, fontSize, color, position) {
  const safeText = String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  let y = height * 0.9; // bottom
  if (position === "top") {
    y = height * 0.15;
  }

  return `
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <style>
    .overlay-text {
      fill: ${color};
      font-size: ${fontSize}px;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
  </style>
  <text x="50%" y="${y}" text-anchor="middle" class="overlay-text">${safeText}</text>
</svg>`;
}
