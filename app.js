const AI_API_URL = 'http://192.168.0.52:8001/v1/chat/completions';
const AI_MODEL = 'gemma3';

const pageInput = document.getElementById('pageInput');
const pagePreview = document.getElementById('pagePreview');
const analyzeBtn = document.getElementById('analyzeBtn');
const results = document.getElementById('results');
const processingCanvas = document.getElementById('processingCanvas');
const downloadBtn = document.getElementById('downloadBtn');

let pageImage = null;
let analysisResult = null;
let ohuhuPalette = [];
let guideState = {
    currentStep: 0,
    steps: [],
    guideImg: null,
    guideCanvas: null,
    guideCtx: null,
    playing: false,
    playInterval: null
};

pageInput.addEventListener('change', (e) => handleFile(e.target.files[0], pagePreview));
downloadBtn.addEventListener('click', downloadGuide);

fetch('palette.json')
    .then(response => {
        if (!response.ok) throw new Error(`Palette request failed (${response.status})`);
        return response.json();
    })
    .then(data => {
        ohuhuPalette = data;
        checkReady();
    })
    .catch(error => showError(`Could not load the marker palette: ${error.message}`));

function handleFile(file, previewEl) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
            pageImage = img;
            document.getElementById('pageUpload').classList.add('has-image');
            previewEl.innerHTML = `<img src="${event.target.result}" alt="preview">`;
            checkReady();
        };
        img.onerror = () => showError('The selected file could not be read as an image.');
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
}

function checkReady() {
    analyzeBtn.disabled = !(pageImage && ohuhuPalette.length);
}

analyzeBtn.addEventListener('click', async () => {
    if (!pageImage || !ohuhuPalette.length) return;

    analyzeBtn.disabled = true;
    analyzeBtn.textContent = 'Analyzing with local AI...';
    clearError();

    try {
        analysisResult = await runAnalysis(pageImage);
        renderResults(analysisResult);
        results.hidden = false;
        results.scrollIntoView({ behavior: 'smooth' });
    } catch (error) {
        showError(`AI analysis failed: ${error.message}`);
    } finally {
        analyzeBtn.disabled = false;
        analyzeBtn.textContent = 'Analyze & Create Guide';
    }
});

async function runAnalysis(pageImg) {
    const plan = await analyzeWithAI(pageImg);
    const suggestions = plan.areas;
    const steps = suggestions.map((suggestion, index) => ({
        ...suggestion,
        order: index + 1,
        color: suggestion.hex,
        text: `${suggestion.region} (${suggestion.tonalRole}) — use ${suggestion.name} (${suggestion.code}). ${suggestion.reason}`
    }));

    return {
        palette: ohuhuPalette,
        schemes: [{
            name: plan.theme,
            mood: plan.mood,
            why: plan.description,
            areas: suggestions
        }],
        recommendation: plan.description,
        suggestions,
        matched: suggestions.map(suggestion => ({
            closest: suggestion,
            region: { description: suggestion.region }
        })),
        steps,
        tips: [
            'Lay down base colors first, then add shadows and highlights in separate passes.',
            'Test each marker on a scrap of the same paper before coloring the page.',
            'Blend neighboring colors while the ink is still wet, but leave bright highlights unblended.',
            'Use the darkest accent sparingly around overlaps and focal details to create depth.'
        ]
    };
}

async function analyzeWithAI(img, retry = false) {
    const imageData = imageToDataUrl(img, 1024, 'image/jpeg');
    const prompt = [
        'Study the uploaded coloring page carefully and act as an art director, not a nearest-color matcher.',
        'Identify the actual objects and visual roles in the image: for example character, clothing, planet, sky, stars, plants, props, shadows, and background. Use descriptions grounded in what is visibly present.',
        'Create ONE distinctive, appealing color scheme for this specific image. Do not make it generic.',
        'Give it a memorable theme, clear focal point, dramatic light direction, light/mid/dark contrast, and an accent color. Avoid bland palettes dominated by blue, beige, gray, brown, or near-duplicate colors.',
        'First choose ideal artistic colors freely as standard six-digit hex colors. Do not think about marker brands, marker names, or available marker limitations.',
        'Use 8 to 14 clearly different color assignments when the drawing supports it. Include warm colors, cool colors, and at least one strong accent.',
        'Do not make every object a single flat fill. For important objects, add separate areas for a base, a dark shadow, and a light highlight. Use tonalRole values base, shadow, highlight, or accent.',
        'Use a consistent light source from the upper left: shadows go lower right and highlights go upper left. Add rim light or reflected color when it improves the design.',
        'Highlights should be noticeably lighter and often warmer or more saturated than the base. Shadows should be visibly darker and may shift hue. Avoid using pure white or pure black except for tiny accents.',
        'Order the areas as background, base colors, shadows, then highlights and small accents.',
        'Return ONLY valid JSON in this exact shape. Keep every reason and description under 12 words and do not use quotation marks inside string values:',
        '{"theme":"short memorable theme","mood":"short mood","description":"why this scheme suits the image","lightDirection":"upper left","areas":[{"region":"short object or area description","tonalRole":"base","targetHex":"#rrggbb","reason":"specific artistic reason","x":0.1,"y":0.2,"width":0.4,"height":0.3}]}',
        'Return 8 to 14 areas. Coordinates are normalized from 0 to 1 and are approximate bounding boxes for visible objects. Every targetHex must be a valid six-digit hex color. Do not return marker codes or marker names. Include at least two shadow areas and two highlight or accent areas when the image has enough detail.'
    ].join('\n');

    const response = await fetch(AI_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: AI_MODEL,
            temperature: retry ? 0.2 : 0.8,
            max_tokens: retry ? 1800 : 2400,
            response_format: { type: 'json_object' },
            messages: [
                {
                    role: 'system',
                    content: 'You are a precise coloring-page art director. Follow the requested JSON format exactly.'
                },
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: prompt },
                        { type: 'image_url', image_url: { url: imageData } }
                    ]
                }
            ]
        })
    });

    if (!response.ok) throw new Error(`local AI server returned ${response.status}`);
    const payload = await response.json();
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error('local AI returned no message');

    try {
        return validatePlan(parseJsonResponse(content));
    } catch (error) {
        if (!retry && error.message.startsWith('invalid JSON')) {
            return analyzeWithAI(img, true);
        }
        throw error;
    }
}

function parseJsonResponse(content) {
    const cleaned = content
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
    const starts = [cleaned.indexOf('{'), cleaned.indexOf('[')].filter(index => index >= 0);
    const start = starts.length ? Math.min(...starts) : -1;
    const objectEnd = cleaned.lastIndexOf('}');
    const arrayEnd = cleaned.lastIndexOf(']');
    const end = Math.max(objectEnd, arrayEnd);
    if (start < 0 || end <= start) throw new Error('local AI did not return JSON');

    const candidate = cleaned.slice(start, end + 1);
    try {
        return JSON.parse(candidate);
    } catch (error) {
        const repaired = repairJson(candidate);
        try {
            return JSON.parse(repaired);
        } catch {
            throw new Error(`invalid JSON from local AI: ${error.message}`);
        }
    }
}

function repairJson(value) {
    // Recover the harmless formatting errors local models commonly make.
    return value
        .replace(/\/\/.*$/gm, '')
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
        .replace(/([{,]\s*)([A-Za-z_$][\w$-]*)\s*:/g, '$1"$2":')
        .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_, text) => `"${text.replace(/"/g, '\\"')}"`)
        .replace(/,\s*([}\]])/g, '$1')
        .replace(/\\(?!["\\/bfnrtu])/g, '\\\\');
}

function validatePlan(parsed) {
    // Accept the previous list format once, so a server with an old response is still usable.
    if (Array.isArray(parsed)) {
        const areas = validateSuggestions(parsed);
        return { theme: 'Balanced color plan', mood: 'playful', description: 'A balanced color plan for this page.', areas };
    }
    if (!parsed || !Array.isArray(parsed.areas)) throw new Error('local AI returned no color areas');
    const areas = validateSuggestions(parsed.areas);
    return {
        theme: String(parsed.theme || 'Recommended color plan'),
        mood: String(parsed.mood || 'playful'),
        description: String(parsed.description || 'This scheme is designed for this image.'),
        areas
    };
}

function validateSuggestions(suggestions) {
    const valid = suggestions.map((item, index) => {
        const targetHex = normalizeHex(item.targetHex || item.hex);
        const marker = targetHex ? closestMarker(targetHex) : null;
        if (!marker || !item.region) return null;
        return {
            region: String(item.region).trim(),
            code: marker.code,
            name: marker.name,
            hex: marker.hex.startsWith('#') ? marker.hex : `#${marker.hex}`,
            targetHex,
            tonalRole: ['base', 'shadow', 'highlight', 'accent'].includes(String(item.tonalRole).toLowerCase())
                ? String(item.tonalRole).toLowerCase()
                : 'base',
            reason: String(item.reason || 'A balanced choice for this area.').trim(),
            box: normalizeBox(item, index, suggestions.length)
        };
    }).filter(Boolean);

    const unique = [...new Map(valid.map(item => [`${item.region.toLowerCase()}|${item.tonalRole}`, item])).values()];
    if (!unique.length) throw new Error('local AI returned no usable palette suggestions');
    return unique.slice(0, 14);
}

function normalizeHex(value) {
    const text = String(value || '').trim();
    return /^#[0-9a-f]{6}$/i.test(text) ? text.toLowerCase() : null;
}

function closestMarker(targetHex) {
    const target = hexToRgb(targetHex);
    let best = null;
    let bestDistance = Infinity;
    for (const marker of ohuhuPalette) {
        const rgb = hexToRgb(marker.hex);
        if (!rgb) continue;
        const distance = colorDistance(target, rgb);
        if (distance < bestDistance) {
            bestDistance = distance;
            best = marker;
        }
    }
    return best;
}

function hexToRgb(hex) {
    const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return match ? {
        r: parseInt(match[1], 16),
        g: parseInt(match[2], 16),
        b: parseInt(match[3], 16)
    } : null;
}

function colorDistance(first, second) {
    const red = first.r - second.r;
    const green = first.g - second.g;
    const blue = first.b - second.b;
    return red * red + green * green + blue * blue;
}

function imageToDataUrl(img, maxSize, type) {
    const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
    const width = Math.max(1, Math.round(img.width * scale));
    const height = Math.max(1, Math.round(img.height * scale));
    processingCanvas.width = width;
    processingCanvas.height = height;
    const context = processingCanvas.getContext('2d');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, width, height);
    context.drawImage(img, 0, 0, width, height);
    return processingCanvas.toDataURL(type, 0.85);
}

function renderResults(result) {
    document.getElementById('regionsMap').innerHTML = result.steps.map(step =>
        `<span class="region-badge"><span class="swatch" style="background:${step.color}"></span>${escapeHtml(step.region)}</span>`
    ).join('');

    const uniqueMarkers = [...new Map(result.steps.map(step => [step.code, step])).values()];
    document.getElementById('matchedColors').innerHTML = uniqueMarkers.map(step =>
        `<div class="color-swatch-card"><span class="swatch" style="background:${step.color}"></span><span class="label">${escapeHtml(step.name)} (${escapeHtml(step.code)})</span></div>`
    ).join('');

    document.getElementById('steps').innerHTML = result.steps.map(step =>
        `<li><span class="color-hint" style="background:${step.color}"></span>${escapeHtml(step.text)}</li>`
    ).join('');
    document.getElementById('tips').innerHTML = result.tips.map(tip => `<li>${escapeHtml(tip)}</li>`).join('');
    document.getElementById('colorRecommendation').textContent = result.recommendation;
    document.getElementById('colorSchemes').innerHTML = result.schemes.map((scheme, index) => `
        <article class="scheme-card ${index === 0 ? 'recommended' : ''}">
            <h4>${escapeHtml(scheme.name)}${index === 0 ? ' <span>Recommended</span>' : ''}</h4>
            <p class="scheme-mood">${escapeHtml(scheme.mood)}</p>
            <p>${escapeHtml(scheme.why)}</p>
            <div class="scheme-swatches">${scheme.areas.map(area => `<span title="${escapeHtml(area.region)}" style="background:${area.hex}"></span>`).join('')}</div>
        </article>`).join('');

    initVisualGuide(result);
}

function initVisualGuide(result) {
    const canvas = document.getElementById('guideCanvas');
    const context = canvas.getContext('2d');
    const guideImg = new Image();
    guideImg.onload = () => {
        const scale = Math.min(800 / guideImg.width, 1);
        canvas.width = Math.max(1, Math.floor(guideImg.width * scale));
        canvas.height = Math.max(1, Math.floor(guideImg.height * scale));
        guideState = { ...guideState, currentStep: 0, steps: result.steps, guideImg, guideCanvas: canvas, guideCtx: context, playing: false };
        renderGuideStep(0);
        renderStepGallery();
        updateStepUI();
    };
    guideImg.src = pageImage.src;
}

document.getElementById('stepPrev').addEventListener('click', () => changeGuideStep(-1));
document.getElementById('stepNext').addEventListener('click', () => changeGuideStep(1));
document.getElementById('stepAutoPlay').addEventListener('click', togglePlayback);

function changeGuideStep(delta) {
    const next = guideState.currentStep + delta;
    if (next < 0 || next > guideState.steps.length) return;
    guideState.currentStep = next;
    renderGuideStep(next);
    updateStepUI();
}

function togglePlayback() {
    const button = document.getElementById('stepAutoPlay');
    if (guideState.playing) {
        clearInterval(guideState.playInterval);
        guideState.playing = false;
        button.textContent = '▶ Play';
        return;
    }
    guideState.playing = true;
    button.textContent = '⏸ Pause';
    guideState.playInterval = setInterval(() => {
        if (guideState.currentStep >= guideState.steps.length) {
            clearInterval(guideState.playInterval);
            guideState.playing = false;
            button.textContent = '▶ Play';
            return;
        }
        changeGuideStep(1);
    }, 900);
}

function renderGuideStep(step) {
    const { guideCanvas, guideCtx, guideImg } = guideState;
    if (!guideCanvas || !guideImg) return;
    drawColoredGuide(guideCtx, guideCanvas.width, guideCanvas.height, step);

}

function drawColoredGuide(context, width, height, step) {
    context.clearRect(0, 0, width, height);
    context.drawImage(guideState.guideImg, 0, 0, width, height);
    if (!step) {
        context.fillStyle = 'rgba(0, 0, 0, 0.08)';
        context.fillRect(0, 0, width, height);
        return;
    }

    context.save();
    guideState.steps.slice(0, step).forEach(item => {
        const box = item.box;
        context.fillStyle = item.color;
        context.globalCompositeOperation = item.tonalRole === 'highlight' ? 'screen' : 'multiply';
        context.globalAlpha = item.tonalRole === 'base' ? 0.42 : item.tonalRole === 'highlight' ? 0.62 : 0.58;
        context.fillRect(box.x * width, box.y * height, box.width * width, box.height * height);
    });
    context.restore();

    context.save();
    context.font = `${Math.max(13, Math.round(width / 55))}px sans-serif`;
    guideState.steps.slice(0, step).forEach((item, index) => {
        const box = item.box;
        const x = Math.max(4, box.x * width + 5);
        const y = Math.max(18, box.y * height + 20);
        context.fillStyle = 'rgba(255,255,255,0.88)';
        context.fillRect(x - 4, y - 17, context.measureText(`${index + 1}. ${item.code}`).width + 10, 22);
        context.fillStyle = '#222';
        context.fillText(`${index + 1}. ${item.code}`, x, y);
    });
    context.restore();
}

function normalizeBox(item, index, total) {
    const clamp = value => Math.min(1, Math.max(0, Number(value) || 0));
    const hasCoordinates = [item.x, item.y, item.width, item.height].every(value => Number.isFinite(Number(value)));
    const columns = Math.min(3, Math.max(1, Math.ceil(Math.sqrt(total))));
    const fallbackWidth = 0.72 / columns;
    const fallbackHeight = 0.72 / Math.ceil(total / columns);
    const fallbackX = 0.12 + (index % columns) * (0.76 / columns);
    const fallbackY = 0.12 + Math.floor(index / columns) * (0.76 / Math.ceil(total / columns));
    const x = hasCoordinates ? clamp(item.x) : fallbackX;
    const y = hasCoordinates ? clamp(item.y) : fallbackY;
    const width = Math.max(0.08, Math.min(1 - x, hasCoordinates ? clamp(item.width) : fallbackWidth));
    const height = Math.max(0.08, Math.min(1 - y, hasCoordinates ? clamp(item.height) : fallbackHeight));
    return { x, y, width, height };
}

function updateStepUI() {
    const label = guideState.currentStep === 0 ? 'Original' : `Step ${guideState.currentStep}`;
    document.getElementById('stepIndicator').textContent = `${label} (${guideState.currentStep}/${guideState.steps.length})`;
}

function renderStepGallery() {
    const gallery = document.getElementById('stepGallery');
    gallery.innerHTML = '';
    for (let step = 0; step <= guideState.steps.length; step++) {
        const card = document.createElement('div');
        card.className = 'step-thumbnail';
        const canvas = document.createElement('canvas');
        const width = 220;
        const height = Math.round(width * guideState.guideImg.height / guideState.guideImg.width);
        canvas.width = width;
        canvas.height = height;
        drawColoredGuide(canvas.getContext('2d'), width, height, step);
        const label = document.createElement('span');
        label.textContent = step === 0 ? 'Original' : `Step ${step}: ${guideState.steps[step - 1].tonalRole}`;
        card.append(canvas, label);
        card.addEventListener('click', () => {
            guideState.currentStep = step;
            renderGuideStep(step);
            updateStepUI();
        });
        gallery.appendChild(card);
    }
}

function downloadGuide() {
    if (!analysisResult || !pageImage) return;
    const canvas = document.createElement('canvas');
    const width = 1400;
    const imageHeight = Math.round(width * pageImage.height / pageImage.width);
    const thumbWidth = 360;
    const thumbHeight = Math.round(thumbWidth * pageImage.height / pageImage.width);
    const rowHeight = thumbHeight + 70;
    const height = 170 + imageHeight + analysisResult.steps.length * rowHeight + analysisResult.tips.length * 38;
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');

    context.fillStyle = '#faf8f5';
    context.fillRect(0, 0, width, height);
    context.fillStyle = '#2d2d2d';
    context.font = 'bold 46px sans-serif';
    context.fillText('ColorMe Coloring Guide', 50, 65);
    context.font = '24px sans-serif';
    context.fillStyle = '#6b6b6b';
    context.fillText('AI-assisted plan using Ohuhu Honolulu 168 markers', 50, 105);
    context.drawImage(pageImage, 50, 135, width - 100, imageHeight);

    let y = 160 + imageHeight;
    context.fillStyle = '#2d2d2d';
    context.font = 'bold 30px sans-serif';
    context.fillText('Coloring steps', 50, y);
    y += 38;
    analysisResult.steps.forEach((step, index) => {
        const preview = document.createElement('canvas');
        preview.width = thumbWidth;
        preview.height = thumbHeight;
        drawColoredGuide(preview.getContext('2d'), thumbWidth, thumbHeight, index + 1);
        context.drawImage(preview, 50, y - 25, thumbWidth, thumbHeight);
        context.fillStyle = step.color;
        context.fillRect(450, y - 22, 28, 28);
        context.fillStyle = '#2d2d2d';
        context.font = 'bold 22px sans-serif';
        context.fillText(`${index + 1}. ${step.region} (${step.code} ${step.name})`, 500, y);
        context.font = '19px sans-serif';
        context.fillStyle = '#555';
        context.fillText(step.reason, 500, y + 29);
        y += rowHeight;
    });
    context.fillStyle = '#2d2d2d';
    context.font = 'bold 30px sans-serif';
    context.fillText('Tips', 50, y);
    y += 35;
    context.font = '20px sans-serif';
    analysisResult.tips.forEach(tip => {
        context.fillText(`• ${tip}`, 60, y);
        y += 38;
    });

    const link = document.createElement('a');
    link.download = 'colorme-guide.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
}

function showError(message) {
    let error = document.getElementById('appError');
    if (!error) {
        error = document.createElement('p');
        error.id = 'appError';
        error.className = 'app-error';
        document.querySelector('.actions').prepend(error);
    }
    error.textContent = message;
}

function clearError() {
    document.getElementById('appError')?.remove();
}

function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[character]));
}
