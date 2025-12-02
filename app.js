// app.js – 폼 입력값을 모아서 /api/unify 로 보내고 결과를 화면에 표시

function bindSliderValue(id, labelId) {
  const slider = document.getElementById(id);
  const label = document.getElementById(labelId);
  if (!slider || !label) return;
  const update = () => (label.textContent = slider.value);
  slider.addEventListener("input", update);
  update();
}

async function processImages() {
  const fileInput = document.getElementById("images");
  const resultArea = document.getElementById("resultArea");

  resultArea.innerHTML = "";

  const files = fileInput.files;
  if (!files || !files.length) {
    alert("편집할 이미지를 하나 이상 선택해 주세요.");
    return;
  }

  const form = new FormData();

  // 파일들
  for (const f of files) {
    form.append("images", f);
  }

  // 크기 & 배경
  form.append("doResize", document.getElementById("doResize").checked ? "1" : "0");
  form.append("width", document.getElementById("width").value || "512");
  form.append("height", document.getElementById("height").value || "512");
  form.append("keepRatio", document.getElementById("keepRatio").checked ? "1" : "0");
  form.append("fitMode", document.getElementById("fitMode").value);
  form.append("makeTransparent", document.getElementById("makeTransparent").checked ? "1" : "0");

  // 색감 & 대비
  form.append("brightness", document.getElementById("brightness").value || "0");
  form.append("saturation", document.getElementById("saturation").value || "0");
  form.append("contrast", document.getElementById("contrast").value || "0");
  form.append("hue", document.getElementById("hue").value || "0");

  // 라인 & 스타일
  form.append("lineStrength", document.getElementById("lineStrength").value || "0");
  form.append("lineColor", document.getElementById("lineColor").value || "original");

  // 텍스트
  form.append("overlayText", document.getElementById("overlayText").value || "");
  form.append("textSize", document.getElementById("textSize").value || "32");
  form.append("textColor", document.getElementById("textColor").value || "white");
  form.append("textPosition", document.getElementById("textPosition").value || "bottom");

  try {
    const res = await fetch("/api/unify", {
      method: "POST",
      body: form,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || "서버 오류");
    }

    const data = await res.json();
    if (!data.images || !data.images.length) {
      resultArea.innerHTML = "<div>결과 이미지가 없습니다.</div>";
      return;
    }

    data.images.forEach((src, idx) => {
      const box = document.createElement("div");
      box.className = "result-item";

      const img = document.createElement("img");
      img.src = src;

      const label = document.createElement("div");
      label.textContent = `결과 ${idx + 1}`;
      label.style.marginTop = "4px";

      box.appendChild(img);
      box.appendChild(label);
      resultArea.appendChild(box);
    });
  } catch (err) {
    console.error(err);
    alert("처리 중 오류가 발생했습니다: " + err.message);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("runBtn").addEventListener("click", processImages);

  bindSliderValue("brightness", "brightnessVal");
  bindSliderValue("saturation", "saturationVal");
  bindSliderValue("contrast", "contrastVal");
  bindSliderValue("hue", "hueVal");
  bindSliderValue("lineStrength", "lineStrengthVal");
});
