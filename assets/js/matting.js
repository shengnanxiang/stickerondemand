/* ============================================================
   浏览器端模拟去背 —— 替代尚未接入的云端 AI 抠图
   算法：边界连通（flood fill）+ 色差阈值 + 边缘羽化
   真实接口接入后，只需把 removeBackground 换成远程调用即可
   ============================================================ */
(function (global) {
  'use strict';

  var DEFAULT_TOLERANCE = 62;   // 色差容差（0–441 尺度）
  var MAX_SIDE = 1100;          // 处理尺寸上限，兼顾效果与速度

  /** 载入图片 */
  function loadImage(src) {
    return new Promise(function (res, rej) {
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function () { res(img); };
      img.onerror = function () { rej(new Error('图片加载失败')); };
      img.src = src;
    });
  }

  /** 等比缩放后的绘制尺寸 */
  function fitSize(w, h, max) {
    var r = Math.min(1, max / Math.max(w, h));
    return { w: Math.max(1, Math.round(w * r)), h: Math.max(1, Math.round(h * r)) };
  }

  function colorDist(r1, g1, b1, r2, g2, b2) {
    var dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
    return Math.sqrt(dr * dr + dg * dg + db * db);
  }

  /** 取四角 8×8 区域均值作为背景色 */
  function sampleBackground(data, W, H) {
    function area(x0, y0) {
      var r = 0, g = 0, b = 0, n = 0;
      for (var y = y0; y < y0 + 8 && y < H; y++) {
        for (var x = x0; x < x0 + 8 && x < W; x++) {
          var i = (y * W + x) * 4;
          r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
        }
      }
      return n ? [r / n, g / n, b / n] : [255, 255, 255];
    }
    var ps = [area(0, 0), area(W - 9, 0), area(0, H - 9), area(W - 9, H - 9)];
    // 取出现最多的那一类（四角里最接近的两角的均值），降低偶然误差
    var best = ps[0], bestScore = Infinity;
    for (var i = 0; i < ps.length; i++) {
      var s = 0;
      for (var j = 0; j < ps.length; j++) {
        s += colorDist(ps[i][0], ps[i][1], ps[i][2], ps[j][0], ps[j][1], ps[j][2]);
      }
      if (s < bestScore) { bestScore = s; best = ps[i]; }
    }
    return best;
  }

  /**
   * 去背核心
   * @returns {Promise<{dataURL, imageData, width, height, bgColor}>}
   */
  function removeBackground(src, tolerance) {
    var tol = (tolerance == null ? DEFAULT_TOLERANCE : tolerance);
    return loadImage(src).then(function (img) {
      var size = fitSize(img.naturalWidth || img.width, img.naturalHeight || img.height, MAX_SIDE);
      var cv = document.createElement('canvas');
      cv.width = size.w; cv.height = size.h;
      var ctx = cv.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, size.w, size.h);

      var imgData = ctx.getImageData(0, 0, size.w, size.h);
      var data = imgData.data;
      var W = size.w, H = size.h, N = W * H;

      var bg = sampleBackground(data, W, H);

      // ---- 1. 边界连通：只有与外界连通的相似区才判定为背景 ----
      var isBg = new Uint8Array(N);
      var queue = new Int32Array(N);
      var head = 0, tail = 0;

      function trySeed(x, y) {
        var i = (y * W + x) * 4;
        if (colorDist(data[i], data[i + 1], data[i + 2], bg[0], bg[1], bg[2]) < tol) {
          var p = y * W + x;
          if (!isBg[p]) { isBg[p] = 1; queue[tail++] = p; }
        }
      }
      for (var x = 0; x < W; x++) { trySeed(x, 0); trySeed(x, H - 1); }
      for (var y = 0; y < H; y++) { trySeed(0, y); trySeed(W - 1, y); }

      while (head < tail) {
        var p = queue[head++];
        var px = p % W, py = (p / W) | 0;
        for (var dy = -1; dy <= 1; dy++) {
          for (var dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            var nx = px + dx, ny = py + dy;
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            var np = ny * W + nx;
            if (isBg[np]) continue;
            var ni = np * 4;
            if (colorDist(data[ni], data[ni + 1], data[ni + 2], bg[0], bg[1], bg[2]) < tol) {
              isBg[np] = 1; queue[tail++] = np;
            }
          }
        }
      }

      // ---- 2. 生成 alpha：连到背景的透明，边缘按色差渐变 ----
      var alpha = new Float32Array(N);
      for (var k = 0; k < N; k++) {
        var idx = k * 4;
        if (isBg[k]) { alpha[k] = 0; continue; }
        var d = colorDist(data[idx], data[idx + 1], data[idx + 2], bg[0], bg[1], bg[2]);
        // 距离越接近阈值，越偏向半透明
        if (d < tol * 1.6) {
          var t = (d - tol) / (tol * 0.6);
          if (t < 0) t = 0; if (t > 1) t = 1;
          alpha[k] = 255 * t;
        } else {
          alpha[k] = 255;
        }
      }

      // ---- 3. 羽化柔边（3×3 box blur，两遍）----
      var tmp = new Float32Array(N);
      for (var pass = 0; pass < 2; pass++) {
        for (var yy = 0; yy < H; yy++) {
          for (var xx = 0; xx < W; xx++) {
            var acc = 0, cnt = 0;
            for (var j2 = -1; j2 <= 1; j2++) {
              for (var i2 = -1; i2 <= 1; i2++) {
                var ax = xx + i2, ay = yy + j2;
                if (ax < 0 || ay < 0 || ax >= W || ay >= H) continue;
                acc += alpha[ay * W + ax]; cnt++;
              }
            }
            tmp[yy * W + xx] = acc / cnt;
          }
        }
        alpha.set(tmp);
      }

      // ---- 4. 落回像素数据 ----
      for (var m = 0; m < N; m++) {
        data[m * 4 + 3] = Math.max(0, Math.min(255, Math.round(alpha[m])));
      }
      ctx.putImageData(imgData, 0, 0);

      return {
        dataURL: cv.toDataURL('image/png'),
        imageData: imgData,
        width: W,
        height: H,
        bgColor: bg
      };
    });
  }

  /**
   * 笔刷修补：直接改 alpha 通道
   * @param {ImageData} imgData
   * @param {number} x,y 画布像素坐标（已按显示比例换算）
   * @param {number} r 半径
   * @param {'erase'|'restore'} mode
   * @param {number} hardness 0–1，边缘软硬
   */
  function stroke(imgData, x, y, r, mode, hardness) {
    var W = imgData.width, H = imgData.height, data = imgData.data;
    var hard = hardness == null ? 0.6 : hardness;
    var rr = r * r;
    var x0 = Math.max(0, Math.floor(x - r)), x1 = Math.min(W - 1, Math.ceil(x + r));
    var y0 = Math.max(0, Math.floor(y - r)), y1 = Math.min(H - 1, Math.ceil(y + r));
    var target = mode === 'erase' ? 0 : 255;

    for (var py = y0; py <= y1; py++) {
      for (var px = x0; px <= x1; px++) {
        var dx = px - x, dy = py - y;
        var d2 = dx * dx + dy * dy;
        if (d2 > rr) continue;
        var d = Math.sqrt(d2) / r;
        // d < hard 全强度，之后线性衰减
        var strength = d <= hard ? 1 : 1 - (d - hard) / (1 - hard);
        if (strength <= 0) continue;
        var i = (py * W + px) * 4;
        var cur = data[i + 3];
        var next = cur + (target - cur) * strength;
        data[i + 3] = Math.max(0, Math.min(255, Math.round(next)));
      }
    }
  }

  /** 把 ImageData 输出为 PNG dataURL */
  function toURL(imgData) {
    var cv = document.createElement('canvas');
    cv.width = imgData.width; cv.height = imgData.height;
    cv.getContext('2d').putImageData(imgData, 0, 0);
    return cv.toDataURL('image/png');
  }

  /** ImageData 深拷贝（用于「重置」） */
  function cloneImageData(d) {
    return new ImageData(new Uint8ClampedArray(d.data), d.width, d.height);
  }

  global.Matting = {
    DEFAULT_TOLERANCE: DEFAULT_TOLERANCE,
    removeBackground: removeBackground,
    stroke: stroke,
    toURL: toURL,
    cloneImageData: cloneImageData,
    loadImage: loadImage
  };
})(window);
