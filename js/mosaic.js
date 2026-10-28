(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const state = { target: null, targetName: "", tiles: [], tileNames: [], previewReady: false, busy: false };
  const preview = $("mosaicPreview");
  const previewCtx = preview.getContext("2d", { willReadFrequently: true });
  const scratch = document.createElement("canvas");
  const scratchCtx = scratch.getContext("2d", { willReadFrequently: true });
  const tileSample = document.createElement("canvas");
  tileSample.width = tileSample.height = 16;
  const tileCtx = tileSample.getContext("2d", { willReadFrequently: true });

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(file.name + " を読み込めませんでした")); };
      img.src = url;
    });
  }
  function meanColor(img) {
    tileCtx.clearRect(0, 0, 16, 16);
    tileCtx.drawImage(img, 0, 0, 16, 16);
    const d = tileCtx.getImageData(0, 0, 16, 16).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3] / 255;
      r += d[i] * a; g += d[i + 1] * a; b += d[i + 2] * a; n += a;
    }
    return n ? [r / n, g / n, b / n] : [128, 128, 128];
  }
  function drawTargetThumb(img) {
    const thumb = $("mosaicTargetThumb");
    const c = thumb.getContext("2d");
    thumb.width = 160; thumb.height = 120;
    c.clearRect(0, 0, thumb.width, thumb.height);
    const scale = Math.min(thumb.width / img.naturalWidth, thumb.height / img.naturalHeight);
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    c.imageSmoothingEnabled = true;
    c.drawImage(img, Math.round((thumb.width - w) / 2), Math.round((thumb.height - h) / 2), w, h);
  }
  function renderTileGallery() {
    const gallery = $("mosaicTilesGallery");
    gallery.replaceChildren();
    const shown = Math.min(state.tiles.length, 24);
    for (let i = 0; i < shown; i++) {
      const thumb = document.createElement("canvas");
      thumb.width = thumb.height = 64;
      thumb.className = "mosaic-tile-thumb";
      thumb.title = state.tileNames[i] || ("写真 " + (i + 1));
      thumb.setAttribute("role", "img");
      thumb.setAttribute("aria-label", thumb.title);
      const c = thumb.getContext("2d");
      const img = state.tiles[i];
      const scale = Math.max(64 / img.naturalWidth, 64 / img.naturalHeight);
      const w = img.naturalWidth * scale, h = img.naturalHeight * scale;
      c.imageSmoothingEnabled = true;
      c.drawImage(img, (64 - w) / 2, (64 - h) / 2, w, h);
      gallery.appendChild(thumb);
    }
    if (state.tiles.length > shown) {
      const more = document.createElement("div");
      more.className = "mosaic-tile-more";
      more.textContent = "+" + (state.tiles.length - shown);
      more.title = "ほか " + (state.tiles.length - shown) + " 枚";
      gallery.appendChild(more);
    }
    $("mosaicTilesEmpty").hidden = state.tiles.length > 0;
  }
  function updateInputs() {
    const canGenerate = !!state.target && state.tiles.length > 0 && !state.busy;
    $("mosaicGenerateBtn").disabled = !canGenerate;
    $("mosaicExportBtn").disabled = !state.previewReady || state.busy;
    $("mosaicTargetCard").classList.toggle("is-complete", !!state.target);
    $("mosaicTilesCard").classList.toggle("is-complete", state.tiles.length > 0);
    $("mosaicTilesCount").textContent = state.tiles.length + "枚";
    $("mosaicTargetAction").textContent = state.target ? "別の画像を選ぶ" : "ここを押して画像を選ぶ";
    $("mosaicTilesAction").textContent = state.tiles.length ? "写真を追加する" : "ここを押して写真を追加";
    if (state.target) $("mosaicTargetInfo").textContent = state.target.naturalWidth + " × " + state.target.naturalHeight + " px";
    $("mosaicTilesInfo").textContent = state.tiles.length
      ? state.tiles.length + " 枚の写真が使われます。タップして追加できます。"
      : "まだ写真は選ばれていません。";
  }
  function setStatus(s) { $("mosaicStatus").textContent = s; }
  function updateLabels() {
    $("mosaicDetailValue").textContent = $("mosaicDetail").value + " マス";
    $("mosaicBlendValue").textContent = $("mosaicBlend").value + "%";
  }
  $("mosaicDetail").addEventListener("input", updateLabels);
  $("mosaicBlend").addEventListener("input", updateLabels);

  $("mosaicTargetInput").addEventListener("change", async e => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!f) return;
    try {
      const img = await loadImage(f);
      state.target = img; state.targetName = f.name; state.previewReady = false;
      drawTargetThumb(img);
      $("mosaicTargetName").textContent = f.name;
      $("mosaicTargetPreview").hidden = false;
      preview.hidden = true;
      $("mosaicEmpty").hidden = false;
      $("mosaicPreviewMeta").textContent = "ここに生成結果が表示されます。";
      setStatus("①完成イメージを読み込みました。次に②モザイクに使う写真を追加してください。");
      updateInputs();
    } catch (err) { setStatus(err.message || "画像を読み込めませんでした。"); }
  });
  $("mosaicTilesInput").addEventListener("change", async e => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;
    setStatus("タイル画像を読み込んでいます…");
    const loaded = await Promise.all(files.map(async file => {
      try { const image = await loadImage(file); return { image, name: file.name, color: meanColor(image) }; }
      catch (err) { return null; }
    }));
    const good = loaded.filter(Boolean);
    // Extend the existing tile library instead of replacing it, so users can add images in batches.
    state.tiles.push(...good.map(x => x.image));
    state.tileNames.push(...good.map(x => x.name));
    state.previewReady = false;
    preview.hidden = true;
    $("mosaicEmpty").hidden = false;
    $("mosaicPreviewMeta").textContent = "写真を追加したら、もう一度「モザイクを生成」を押してください。";
    if (good.length) setStatus(good.length + " 枚を追加しました。写真は合計 " + state.tiles.length + " 枚。両方の画像を選んだら「モザイクを生成」を押してください。");
    else setStatus("読み込める画像がありませんでした。PNG/JPEG/WebPを選んでください。");
    // Cache averages once, not during generation.
    state.tileColors = (state.tileColors || []).concat(good.map(x => x.color));
    renderTileGallery();
    updateInputs();
  });

  function getGeometry(target, longEdgeCells) {
    const aspect = target.naturalWidth / target.naturalHeight;
    let cols, rows;
    if (aspect >= 1) { cols = longEdgeCells; rows = Math.max(1, Math.round(longEdgeCells / aspect)); }
    else { rows = longEdgeCells; cols = Math.max(1, Math.round(longEdgeCells * aspect)); }
    return { cols, rows, aspect, width: target.naturalWidth, height: target.naturalHeight };
  }
  function sampleTarget(target, cols, rows) {
    scratch.width = cols; scratch.height = rows;
    scratchCtx.clearRect(0, 0, cols, rows);
    scratchCtx.imageSmoothingEnabled = true;
    scratchCtx.drawImage(target, 0, 0, cols, rows);
    return scratchCtx.getImageData(0, 0, cols, rows).data;
  }
  function bestTile(r, g, b, index, recent, noRepeat, tileColors) {
    let best = 0, bestScore = Infinity;
    for (let j = 0; j < tileColors.length; j++) {
      const c = tileColors[j];
      const dr = r - c[0], dg = g - c[1], db = b - c[2];
      let score = dr * dr * 0.30 + dg * dg * 0.59 + db * db * 0.11;
      if (noRepeat && recent.includes(j)) score *= 1.32;
      if (score < bestScore) { bestScore = score; best = j; }
    }
    return best;
  }
  async function drawMosaic(canvas, target, longEdge, gridLongEdge, blendPercent, noRepeat, wantProgress) {
    const geom = getGeometry(target, gridLongEdge);
    const outW = geom.aspect >= 1 ? longEdge : Math.max(1, Math.round(longEdge * geom.aspect));
    const outH = geom.aspect >= 1 ? Math.max(1, Math.round(longEdge / geom.aspect)) : longEdge;
    canvas.width = outW; canvas.height = outH;
    const c = canvas.getContext("2d");
    c.imageSmoothingEnabled = true;
    const pixels = sampleTarget(target, geom.cols, geom.rows);
    const colors = state.tileColors;
    const recent = [];
    const historyLimit = Math.max(1, Math.min(5, Math.floor(colors.length / 6)));
    const cellW = outW / geom.cols, cellH = outH / geom.rows;
    // Draw a chosen full tile image into each cell, matching its average color to the target image.
    for (let y = 0; y < geom.rows; y++) {
      for (let x = 0; x < geom.cols; x++) {
        const i = (y * geom.cols + x) * 4;
        const t = bestTile(pixels[i], pixels[i + 1], pixels[i + 2], i / 4, recent, noRepeat, colors);
        const tile = state.tiles[t];
        const px = Math.round(x * cellW), py = Math.round(y * cellH);
        const nextX = Math.round((x + 1) * cellW), nextY = Math.round((y + 1) * cellH);
        c.drawImage(tile, px, py, nextX - px, nextY - py);
        if (noRepeat) {
          recent.push(t);
          if (recent.length > historyLimit) recent.shift();
        }
      }
      if (wantProgress && y % 5 === 0) {
        setStatus("モザイクを生成中… " + Math.round((y / geom.rows) * 100) + "%");
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
    if (blendPercent > 0) {
      c.save();
      c.globalAlpha = blendPercent / 100;
      c.drawImage(target, 0, 0, outW, outH);
      c.restore();
    }
    return { width: outW, height: outH, cells: geom.cols + " × " + geom.rows };
  }
  async function runPreview() {
    if (!state.target || !state.tiles.length || state.busy) return;
    state.busy = true; updateInputs(); state.previewReady = false; preview.hidden = false; $("mosaicEmpty").hidden = true;
    try {
      const cells = +$("mosaicDetail").value;
      const res = await drawMosaic(preview, state.target, 1200, cells, +$("mosaicBlend").value, $("mosaicNoRepeat").checked, true);
      state.previewReady = true;
      $("mosaicEmpty").hidden = true;
      $("mosaicPreviewMeta").textContent = res.cells + " マス ・ プレビュー " + res.width + " × " + res.height + " px";
      setStatus("生成完了。タイルの細かさや元画像の混ぜ具合を調整して再生成できます。");
    } catch (err) { preview.hidden = true; $("mosaicEmpty").hidden = false; setStatus("生成に失敗しました。画像枚数やサイズを変えて再度お試しください。"); }
    finally { state.busy = false; updateInputs(); }
  }
  $("mosaicGenerateBtn").addEventListener("click", runPreview);
  $("mosaicExportBtn").addEventListener("click", async () => {
    if (!state.target || !state.tiles.length || state.busy) return;
    state.busy = true; updateInputs();
    try {
      const longEdge = +$("mosaicResolution").value;
      setStatus(longEdge + " px のPNGを書き出しています…");
      const out = document.createElement("canvas");
      const res = await drawMosaic(out, state.target, longEdge, +$("mosaicDetail").value, +$("mosaicBlend").value, $("mosaicNoRepeat").checked, true);
      const blob = await new Promise((resolve, reject) => out.toBlob(b => b ? resolve(b) : reject(new Error("PNGを作成できませんでした")), "image/png"));
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "photo-mosaic-" + longEdge + "px.png";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      setStatus("PNGを書き出しました（" + res.width + " × " + res.height + " px）。");
    } catch (err) { setStatus("書き出しに失敗しました。出力サイズを小さくして再度お試しください。"); }
    finally { state.busy = false; updateInputs(); }
  });
  function setMode(mode) {
    const mosaic = mode === "mosaic";
    $("pixelWorkspace").hidden = mosaic;
    $("mosaicWorkspace").hidden = !mosaic;
    document.body.classList.toggle("mosaic-mode", mosaic);
    $("pixelModeBtn").classList.toggle("active", !mosaic);
    $("mosaicModeBtn").classList.toggle("active", mosaic);
    $("pixelModeBtn").setAttribute("aria-pressed", String(!mosaic));
    $("mosaicModeBtn").setAttribute("aria-pressed", String(mosaic));
    if (!mosaic) window.dispatchEvent(new Event("resize"));
  }
  $("pixelModeBtn").addEventListener("click", () => setMode("pixel"));
  $("mosaicModeBtn").addEventListener("click", () => setMode("mosaic"));
  $("mosaicClearBtn").addEventListener("click", () => {
    state.target = null;
    state.targetName = "";
    state.tiles = [];
    state.tileNames = [];
    state.tileColors = [];
    state.previewReady = false;
    preview.width = 1200; preview.height = 800;
    previewCtx.clearRect(0, 0, preview.width, preview.height);
    preview.hidden = true;
    $("mosaicEmpty").hidden = false;
    $("mosaicTargetInput").value = "";
    $("mosaicTilesInput").value = "";
    $("mosaicTargetPreview").hidden = true;
    $("mosaicTargetThumb").getContext("2d").clearRect(0, 0, 160, 120);
    $("mosaicTargetName").textContent = "画像を選択済み";
    $("mosaicTilesGallery").replaceChildren();
    $("mosaicTilesEmpty").hidden = false;
    $("mosaicPreviewMeta").textContent = "ここに生成結果が表示されます。";
    setStatus("リセットしました。①完成イメージ、②使う写真の順に選んでください。");
    updateInputs();
  });
  updateLabels(); updateInputs();
})();