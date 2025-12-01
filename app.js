async function unifyImages() {
  const ref = document.getElementById("refImage").files[0];
  const images = document.getElementById("targetImages").files;
  const size = document.getElementById("optSize").value;

  if (!ref) {
    alert("기준 이미지를 선택하세요.");
    return;
  }
  if (!images.length) {
    alert("통일할 이미지를 올려주세요.");
    return;
  }

  const form = new FormData();
  form.append("ref", ref);
  for (const f of images) form.append("targets", f);
  form.append("size", size);

  const res = await fetch("/api/unify", {
    method: "POST",
    body: form
  });

  const data = await res.json();
  const resultArea = document.getElementById("resultArea");
  resultArea.innerHTML = "";

  data.images.forEach((src) => {
    const box = document.createElement("div");
    box.className = "result-item";

    const img = document.createElement("img");
    img.src = src;
    box.appendChild(img);

    resultArea.appendChild(box);
  });
}

// 버튼 연결
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("runBtn").addEventListener("click", unifyImages);
});
