const pageInput = document.getElementById('pageInput');
const pagePreview = document.getElementById('pagePreview');
const analyzeBtn = document.getElementById('analyzeBtn');
const results = document.getElementById('results');
const processingCanvas = document.getElementById('processingCanvas');
const ctx = processingCanvas.getContext('2d', { willReadFrequently: true });

let pageImage = null;
let analysisResult = null;
let ohuhuPalette = [];

pageInput.addEventListener('change', (e) => handleFile(e.target.files[0], pagePreview));

fetch('palette.json')
    .then(r => r.json())
    .then(data => { ohuhuPalette = data; checkReady(); });

function handleFile(file, previewEl) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            pageImage = img;
            document.getElementById('pageUpload').classList.add('has-image');
            previewEl.innerHTML = `<img src="${e.target.result}" alt="preview">`;
            checkReady();
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

function checkReady() {
    analyzeBtn.disabled = !(pageImage && colorsImage);
}

analyzeBtn.addEventListener('click', () => {
    if (!pageImage) return;
    analyzeBtn.disabled = true;
    analyzeBtn.textContent = 'Analyzing...';
    setTimeout(() => {
        analysisResult = runAnalysis(pageImage);
        renderResults(analysisResult);
        analyzeBtn.disabled = false;
        analyzeBtn.textContent = 'Analyze & Create Guide';
        results.hidden = false;
        results.scrollIntoView({ behavior: 'smooth' });
    }, 100);
});

function runAnalysis(pageImg) {
    const pageResult = extractRegions(pageImg);
    const palette = ohuhuPalette;
    const matched = matchColors(pageResult.regions, palette);
    const steps = generateSteps(pageResult.regions, matched);
    const tips = generateTips(pageResult.regions, matched);
    return { regions: pageResult.regions, palette, matched, steps, tips, pageScale: pageResult.scale, pageW: pageResult.w, pageH: pageResult.h };
}

function extractRegions(img) {
    const size = 300;
    const scale = Math.min(size / img.width, size / img.height);
    const w = Math.floor(img.width * scale);
    const h = Math.floor(img.height * scale);
    processingCanvas.width = w;
    processingCanvas.height = h;
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;

    const visited = new Uint8Array(w * h);
    const regions = [];

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const idx = y * w + x;
            if (visited[idx]) continue;
            const r = data[idx * 4], g = data[idx * 4 + 1], b = data[idx * 4 + 2];
            if (isLineColor(r, g, b)) continue;

            const region = floodFill(data, w, h, visited, x, y, r, g, b, 35);
            if (region.pixels.length > 80) {
                regions.push(region);
            }
        }
    }
    return { regions, scale, w, h };
}

function isLineColor(r, g, b) {
    const brightness = (r + g + b) / 3;
    return brightness < 55;
}

function floodFill(data, w, h, visited, startX, startY, tr, tg, tb, threshold) {
    const stack = [[startX, startY]];
    const pixels = [];
    let totalR = 0, totalG = 0, totalB = 0;
    const minR = tr, maxR = tr, minG = tg, maxG = tg, minB = tb, maxB = tb;

    while (stack.length > 0) {
        const [x, y] = stack.pop();
        const idx = y * w + x;
        if (visited[idx]) continue;

        const r = data[idx * 4], g = data[idx * 4 + 1], b = data[idx * 4 + 2];
        if (isLineColor(r, g, b)) continue;

        const dr = Math.abs(r - tr), dg = Math.abs(g - tg), db = Math.abs(b - tb);
        if (dr > threshold || dg > threshold || db > threshold) continue;

        visited[idx] = 1;
        pixels.push({ x, y });
        totalR += r; totalG += g; totalB += b;

        const neighbors = [[x+1,y],[x-1,y],[x,y+1],[x,y-1]];
        for (const [nx, ny] of neighbors) {
            if (nx >= 0 && nx < w && ny >= 0 && ny < h && !visited[ny * w + nx]) {
                stack.push([nx, ny]);
            }
        }
    }

    const avgR = totalR / pixels.length;
    const avgG = totalG / pixels.length;
    const avgB = totalB / pixels.length;

    return {
        pixels,
        color: { r: Math.round(avgR), g: Math.round(avgG), b: Math.round(avgB) },
        area: pixels.length
    };
}

function extractPalette(img) {
    const maxSize = 200;
    const scale = Math.min(maxSize / img.width, maxSize / img.height);
    const w = Math.floor(img.width * scale);
    const h = Math.floor(img.height * scale);
    processingCanvas.width = w;
    processingCanvas.height = h;
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;

    const samples = [];
    const step = Math.max(1, Math.floor((w * h) / 5000));
    let i = 0;
    while (i < data.length) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const brightness = (r + g + b) / 3;
        if (brightness > 30 && !(r < 40 && g < 40 && b < 40)) {
            samples.push({ r, g, b });
        }
        i += 4 * step;
    }

    const clustered = kMeans(samples, Math.min(12, samples.length));
    return deduplicatePalette(clustered);
}

function deduplicatePalette(colors) {
    const unique = [];
    for (const color of colors) {
        let isDuplicate = false;
        for (const existing of unique) {
            if (colorDist(color, existing) < 800) {
                if (colorDist(color, existing) < 400) {
                    const avgCount = 2;
                    existing.r = Math.round((existing.r + color.r) / 2);
                    existing.g = Math.round((existing.g + color.g) / 2);
                    existing.b = Math.round((existing.b + color.b) / 2);
                }
                isDuplicate = true;
                break;
            }
        }
        if (!isDuplicate) {
            unique.push({ ...color });
        }
    }
    return unique.filter(c => {
        const hsl = rgbToHsl(c.r, c.g, c.b);
        const [h, s, l] = hsl;
        if (s < 12) return false;
        if (l > 90) return false;
        if (l < 5) return false;
        return true;
    });
}

function kMeans(data, k) {
    if (data.length === 0) return [];
    if (data.length <= k) return data.map(d => ({ r: d.r, g: d.g, b: d.b, count: 1 }));

    let centers = [];
    for (let i = 0; i < k; i++) {
        centers.push({ ...data[Math.floor(Math.random() * data.length)] });
    }

    const assignments = new Array(data.length);
    const iterations = 15;

    for (let iter = 0; iter < iterations; iter++) {
        for (let i = 0; i < data.length; i++) {
            let minDist = Infinity, minIdx = 0;
            for (let j = 0; j < k; j++) {
                const d = colorDist(data[i], centers[j]);
                if (d < minDist) { minDist = d; minIdx = j; }
            }
            assignments[i] = minIdx;
        }

        const sums = centers.map(() => ({ r: 0, g: 0, b: 0, count: 0 }));
        for (let i = 0; i < data.length; i++) {
            const c = sums[assignments[i]];
            c.r += data[i].r; c.g += data[i].g; c.b += data[i].b; c.count++;
        }
        for (let j = 0; j < k; j++) {
            if (sums[j].count > 0) {
                centers[j] = { r: Math.round(sums[j].r / sums[j].count), g: Math.round(sums[j].g / sums[j].count), b: Math.round(sums[j].b / sums[j].count) };
            }
        }
    }

    return centers.filter(c => c.r !== undefined);
}

function colorDist(c1, c2) {
    const dr = c1.r - c2.r, dg = c1.g - c2.g, db = c1.b - c2.b;
    return dr * dr + dg * dg + db * db;
}

function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : null;
}

function matchColors(regions, palette) {
    return regions.map(region => {
        let bestColor = palette[0];
        let bestDist = Infinity;
        for (const color of palette) {
            const hex = color.hex.startsWith('#') ? color.hex : '#' + color.hex;
            const rgb = hexToRgb(hex);
            if (!rgb) continue;
            const d = colorDist(region.color, rgb);
            if (d < bestDist) { bestDist = d; bestColor = color; }
        }
        return {
            region,
            closest: bestColor,
            matchDist: bestDist
        };
    });
}

function generateSteps(regions, matched) {
    const sorted = matched
        .filter(m => m.region.area > 50)
        .sort((a, b) => b.region.area - a.region.area);

    const steps = [];
    const usedMarkers = new Set();

    for (const match of sorted) {
        if (usedMarkers.has(match.closest.code)) continue;
        usedMarkers.add(match.closest.code);

        const code = match.closest.code;
        const name = match.closest.name;
        const hex = match.closest.hex.startsWith('#') ? match.closest.hex : '#' + match.closest.hex;
        const count = match.region.pixels.length;

        if (count > 15000) {
            steps.push({ color: hex, code, name, text: `Background — Fill the large background area with ${name} (${code})`, size: 'large' });
        } else if (count > 3000) {
            steps.push({ color: hex, code, name, text: `Main elements — Color the bigger shapes with ${name} (${code})`, size: 'medium' });
        } else {
            steps.push({ color: hex, code, name, text: `Details — Use ${name} (${code}) for the smaller sections`, size: 'small' });
        }
    }

    return steps;
}

function generateTips(regions, matched) {
    const tips = [];
    const hasLarge = regions.some(r => r.area > 10000);
    const hasSmall = regions.filter(r => r.area > 50 && r.area <= 1000).length > 3;

    if (hasLarge) tips.push('Start with the largest areas first — they form the foundation of your piece.');
    if (hasSmall) tips.push('Save the smallest, most detailed sections for last to avoid smudging.');
    if (regions.length > 12) tips.push('Work in sections to keep your coloring organized and avoid mixing areas.');
    tips.push('Light, even pressure gives the most consistent results.');
    tips.push('Ohuhu alcohol markers blend well — use a lighter shade to fade edges while the ink is still wet.');

    const darkMarkers = matched.filter(m => {
        const rgb = hexToRgb(m.closest.hex);
        if (!rgb) return false;
        return (rgb.r + rgb.g + rgb.b) / 3 < 80;
    });
    if (darkMarkers.length > 0) tips.push('Your darker markers (120, E515, V416, etc.) show mistakes more — go slowly with them.');

    const lightMarkers = matched.filter(m => {
        const rgb = hexToRgb(m.closest.hex);
        if (!rgb) return false;
        return (rgb.r + rgb.g + rgb.b) / 3 > 220;
    });
    if (lightMarkers.length > 0) tips.push('Your lightest pastels (B21, WG10, RV00, etc.) may need 2-3 passes for full coverage.');

    return tips;
}

function describeColor(r, g, b) {
    const hsl = rgbToHsl(r, g, b);
    const [h, s, l] = hsl;

    if (s < 15) {
        if (l > 80) return 'off-white';
        if (l > 50) return 'light gray';
        if (l > 25) return 'mid gray';
        return 'dark gray';
    }

    let name = '';
    let shade = '';
    let tone = '';

    if (h < 15) name = 'red';
    else if (h < 35) name = 'orange-red';
    else if (h < 45) name = 'orange';
    else if (h < 60) name = 'yellow-orange';
    else if (h < 75) name = 'yellow';
    else if (h < 95) name = 'lime';
    else if (h < 150) name = 'green';
    else if (h < 175) name = 'teal';
    else if (h < 200) name = 'cyan';
    else if (h < 235) name = 'blue';
    else if (h < 265) name = 'indigo';
    else if (h < 290) name = 'violet';
    else if (h < 320) name = 'purple';
    else if (h < 345) name = 'magenta';
    else name = 'rose';

    if (l < 20) shade = 'very dark';
    else if (l < 35) shade = 'dark';
    else if (l < 45) shade = 'deep';
    else if (l < 60) shade = '';
    else if (l < 75) shade = 'light';
    else shade = 'very light';

    if (s < 35) tone = 'muted';
    else if (s < 60) tone = 'soft';
    else if (s > 85) tone = 'vivid';

    const parts = [];
    if (tone) parts.push(tone);
    if (shade) parts.push(shade);
    parts.push(name);
    return parts.join(' ');
}

function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
}

function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
    if (max === min) { h = s = 0; }
    else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = ((g - b) / d + (g < b ? 6 : 0)) * 60; break;
            case g: h = ((b - r) / d + 2) * 60; break;
            case b: h = ((r - g) / d + 4) * 60; break;
        }
    }
    return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
}

function renderResults(result) {
    const { regions, matched, steps, tips } = result;

    document.getElementById('regionsMap').innerHTML = matched
        .filter(m => m.region.area > 50)
        .map(m => {
            const hex = m.closest.hex.startsWith('#') ? m.closest.hex : '#' + m.closest.hex;
            return `<span class="region-badge"><span class="swatch" style="background:${hex}"></span>${m.closest.name} (${m.closest.code})</span>`;
        }).join('');

    const uniqueMarkers = [];
    const seenCodes = new Set();
    for (const m of matched) {
        if (m.region.area <= 50) continue;
        if (seenCodes.has(m.closest.code)) continue;
        seenCodes.add(m.closest.code);
        uniqueMarkers.push(m.closest);
    }

    document.getElementById('matchedColors').innerHTML = uniqueMarkers.slice(0, 30).map(m => {
        const hex = m.hex.startsWith('#') ? m.hex : '#' + m.hex;
        return `<div class="color-swatch-card"><span class="swatch" style="background:${hex}"></span><span class="label">${m.name} (${m.code})</span></div>`;
    }).join('');

    document.getElementById('steps').innerHTML = steps.map(s =>
        `<li><span class="color-hint" style="background:${s.color}"></span>${s.text}</li>`
    ).join('');

    document.getElementById('tips').innerHTML = tips.map(t => `<li>${t}</li>`).join('');

    initVisualGuide(result);
}

let guideState = { currentStep: 0, totalSteps: 0, steps: [], guideImg: null, guideCanvas: null, guideCtx: null, playing: false, playInterval: null };

function initVisualGuide(result) {
    const canvas = document.getElementById('guideCanvas');
    const ctx = canvas.getContext('2d');

    const guideImg = new Image();
    guideImg.onload = () => {
        const maxW = 800;
        const scale = Math.min(maxW / guideImg.width, 1);
        canvas.width = Math.floor(guideImg.width * scale);
        canvas.height = Math.floor(guideImg.height * scale);
        guideState.guideImg = guideImg;
        guideState.guideCanvas = canvas;
        guideState.guideCtx = ctx;
        guideState.steps = result.steps;
        guideState.totalSteps = result.steps.length;
        guideState.currentStep = 0;
        renderGuideStep(0);
        updateStepUI();
    };
    guideImg.src = pageImage.src;

    document.getElementById('stepPrev').addEventListener('click', () => {
        if (guideState.currentStep > 0) {
            guideState.currentStep--;
            renderGuideStep(guideState.currentStep);
            updateStepUI();
        }
    });

    document.getElementById('stepNext').addEventListener('click', () => {
        if (guideState.currentStep < guideState.totalSteps) {
            guideState.currentStep++;
            renderGuideStep(guideState.currentStep);
            updateStepUI();
        }
    });

    document.getElementById('stepAutoPlay').addEventListener('click', function() {
        if (guideState.playing) {
            guideState.playing = false;
            clearInterval(guideState.playInterval);
            this.textContent = '▶ Play';
            this.classList.remove('active');
        } else {
            guideState.playing = true;
            this.textContent = '⏸ Pause';
            this.classList.add('active');
            guideState.playInterval = setInterval(() => {
                if (guideState.currentStep < guideState.totalSteps) {
                    guideState.currentStep++;
                    renderGuideStep(guideState.currentStep);
                    updateStepUI();
                } else {
                    guideState.playing = false;
                    clearInterval(guideState.playInterval);
                    document.getElementById('stepAutoPlay').textContent = '▶ Play';
                    document.getElementById('stepAutoPlay').classList.remove('active');
                }
            }, 800);
        }
    });
}

function renderGuideStep(step) {
    const { guideCanvas, guideCtx } = guideState;
    if (!guideCanvas) return;

    const ctx = guideCtx;
    ctx.clearRect(0, 0, guideCanvas.width, guideCanvas.height);

    ctx.drawImage(guideState.guideImg, 0, 0, guideCanvas.width, guideCanvas.height);

    if (step === 0) {
        ctx.fillStyle = 'rgba(0,0,0,0.08)';
        ctx.fillRect(0, 0, guideCanvas.width, guideCanvas.height);
        return;
    }

    const stepsToApply = guideState.steps.slice(0, step);
    const regionsToColor = [];

    for (const s of stepsToApply) {
        const matched = analysisResult.matched.filter(m => {
            const hex = m.closest.hex.startsWith('#') ? m.closest.hex : '#' + m.closest.hex;
            return hex === s.color;
        });
        for (const m of matched) {
            for (const p of m.region.pixels) {
                regionsToColor.push({ ...p, color: s.color });
            }
        }
    }

    const scaleX = guideCanvas.width / analysisResult.pageW;
    const scaleY = guideCanvas.height / analysisResult.pageH;
    const scaledThreshold = 3;

    for (const point of regionsToColor) {
        const px = point.x * scaleX;
        const py = point.y * scaleY;
        const size = Math.max(2, scaledThreshold * scaleX);

        ctx.fillStyle = point.color;
        ctx.fillRect(Math.floor(px), Math.floor(py), Math.ceil(size), Math.ceil(size));
    }
}

function updateStepUI() {
    const { currentStep, totalSteps } = guideState;
    document.getElementById('stepIndicator').textContent = `Step ${currentStep} / ${totalSteps}`;

    const stepLabels = ['Original', ...guideState.steps.map((s, i) => `Step ${i + 1}`)];
    const currentLabel = stepLabels[currentStep] || `Step ${currentStep}`;
    document.getElementById('stepIndicator').textContent = `${currentLabel} (${currentStep}/${totalSteps})`;
}
