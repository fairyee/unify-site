// api/unify.js
// 업로드된 이미지를 편집해서 PNG dataURL로 돌려주는 Vercel Serverless Function (CommonJS)

// ─────────────────────────────
//  의존성
// ─────────────────────────────
const formidable = require("formidable");
const fs = require("fs");
const sharp = require("sharp");
const { removeBackground } = require("@imgly/background-removal-node");

// Vercel: sharp 쓰려면 node 런타임 지정
module.exports.config = {
  runtime: "nodejs18.x",
};

// 선 색 옵션 → RGB
function getLineColorRGB(name) {
  switch (name) {
    case "brown":
      return { r: 80, g: 50, b: 30 };
    case "navy":
      return { r: 25, g: 35, b: 80 };
    case "white":
      return { r: 245, g: 245, b: 245 };
    default:
      return null; // "original"
  }
}

// 텍스트 오버레이용 SVG 생성
function createTextSVG(width, height, text, fontSize, color, position) {
  const safeText = String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // 위치: top / bottom
  let y = Math.round(height * 0.85); // 기본: 아래쪽
  if (position === "top") {
    y = Math.round(height * 0.2);
  }

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <style>
    .label {
      fill: ${color};
      font-size: ${fontSize}px;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
  </style>
  <text x="50%" y="${y}" text-anchor="middle" dominant-baseline="middle" class="label">
    ${safeText}
  </text>
</svg>
`;
}

// ─────────────────────────────
//  메인 Handler
// ─────────────────────────────
module.exports = (req, res) => {
  // 메서드 체크
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Method not allowed");
    return;
  }

  const form = formidable({ multiples: true });

  form.parse(req, async (err, fields, files) => {
    if (err) {
      console.error("Form parse error:", err);
      res.statusCode = 500;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Form parse error");
      return;
    }

    try {
      // ─────────────────────────────
      //  폼 값 읽기
      // ─────────────────────────────
      const doResize = fields.doResize === "1";
      let width = parseInt(fields.width || "512", 10) || 512;
      let height = parseInt(fields.height || "512", 10) || 512;

      const keepRatio = fields.keepRatio === "1";
      let fitMode = fields.fitMode || "contain"; // contain / cover / fill
      if (!keepRatio) {
        // 비율 유지 안하면 강제 fill 사용
        fitMode = "fill";
      }

      // ✅ 이제 이 플래그는 "AI 배경 제거"를 의미
      const useAiBackgroundRemoval = fields.makeTransparent === "1";

      const brightness = Number(fields.brightness || "0"); // -50 ~ 50
      const saturation = Number(fields.saturation || "0"); // -50 ~ 50
      const contrast = Number(fields.contrast || "0"); // -50 ~ 50
      const hue = Number(fields.hue || "0"); // -180 ~ 180

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

      // ─────────────────────────────
      //  업로드된 각 이미지 처리
      // ─────────────────────────────
      for (const file of items) {
        if (!file) continue;

        // 1) 원본 버퍼 읽기
        let inputBuffer = fs.readFileSync(file.filepath);

        // 2) AI 배경 제거 (remove.bg 비슷한 오픈소스)
        if (useAiBackgroundRemoval) {
          try {
            // background-removal-node는 Blob 또는 ArrayBuffer를 돌려줌
            const blobOrArrayBuffer = await removeBackground(inputBuffer);

            if (blobOrArrayBuffer && typeof blobOrArrayBuffer.arrayBuffer === "function") {
              // Blob 케이스
              const ab = await blobOrArrayBuffer.arrayBuffer();
              inputBuffer = Buffer.from(ab);
            } else if (blobOrArrayBuffer instanceof ArrayBuffer) {
              // ArrayBuffer 케이스
              inputBuffer = Buffer.from(blobOrArrayBuffer);
            } else if (Buffer.isBuffer(blobOrArrayBuffer)) {
              // 혹시 바로 Buffer를 주는 버전
              inputBuffer = blobOrArrayBuffer;
            }
          } catch (bgErr) {
            console.error("Background removal error (fallback to original):", bgErr);
            // 실패해도 그냥 원본으로 진행 (죽지 않게)
          }
        }

        // 3) sharp로 로드
        let img = sharp(inputBuffer).ensureAlpha();

        // 4) 크기/비율/맞추는 방식 처리
        if (doResize) {
          img = img.resize(width, height, {
            fit: fitMode, // contain / cover / fill
            background: { r: 0, g: 0, b: 0, alpha: 0 },
          });
        }

        // 5) 색감 & 대비 조정
        const modBright = 1 + brightness / 100; // 0.5 ~ 1.5
        const modSat = 1 + saturation / 100; // 0.5 ~ 1.5
        const modHue = hue; // -180 ~ 180

        img = img.modulate({
          brightness: modBright,
          saturation: modSat,
          hue: modHue,
        });

        if (contrast !== 0) {
          const c = contrast / 100; // -0.5 ~ 0.5
          img = img.linear(1 + c, -128 * c); // 중간값 128 기준
        }

        // 6) raw 픽셀 접근 (선 굵기/색 조정)
        let { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
        const w = info.width;
        const h = info.height;
        const channels = info.channels; // 보통 4 (RGBA)

        const thresholdLine = 90; // 어두운 선 기준
        const doLine = lineStrength !== 0 || !!lineColor;
        const strength = lineStrength / 50; // -1 ~ 1

        if (doLine) {
          for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
              const idx = (y * w + x) * channels;
              const r = data[idx];
              const g = data[idx + 1];
              const b = data[idx + 2];
              const aIndex = idx + 3;
              const a = data[aIndex];
              const avg = (r + g + b) / 3;

              if (a === 0) continue; // 완전 투명 픽셀은 스킵

              // "선"이라고 보는 픽셀
              if (avg < thresholdLine) {
                let nr = r;
                let ng = g;
                let nb = b;

                // 선 굵기 느낌: 진하게 / 연하게
                if (strength > 0) {
                  const factor = 1 + strength * 0.8;
                  nr = Math.max(0, r / factor);
                  ng = Math.max(0, g / factor);
                  nb = Math.max(0, b / factor);
                } else if (strength < 0) {
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

        // raw → sharp 이미지 다시 감싸기
        img = sharp(data, {
          raw: { width: w, height: h, channels },
        });

        // 7) 텍스트 추가 (SVG overlay)
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

      // 최종 응답
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ images: outImages }));
    } catch (e) {
      console.error("Processing error:", e);
      res.statusCode = 500;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Image processing error");
    }
  });
};
