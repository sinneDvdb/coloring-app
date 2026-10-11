# ColorMe Implementation Plan

## Goal

Build a local application that turns an empty coloring page into:

- A cohesive, image-specific color scheme.
- Universal target colors expressed as hex values.
- The closest available Ohuhu Honolulu 168 marker for each target color.
- A step-by-step guide organized into base, shadow, highlight, and accent phases.
- Accurate cumulative images showing the page colored at each phase.
- An optional AI-generated alcohol-marker preview with realistic shading.
- Editable region assignments when automatic analysis makes a mistake.
- A final PNG, one PNG per phase, and a printable PDF.

The primary usage target is personal and local. The application does not need accounts,
cloud storage, authentication, or a production database.

## Product Decisions

### Inputs

- One empty coloring page is required.
- Zero or more inspiration images are optional.
- Inspiration images influence the palette, not the semantic contents of the page.

### Color recommendations

- The artistic recommendation is always a universal six-digit hex color.
- The universal color must not be replaced with an approximate marker color.
- The backend calculates the nearest Ohuhu Honolulu 168 marker separately.
- Marker matching uses a perceptual color space and CIEDE2000 rather than raw RGB
  distance.

### Steps

Steps are cumulative artistic phases in this fixed order:

1. Base colors
2. Shadows
3. Highlights
4. Accents

The original uncolored page is shown as step zero.

### Correction workflow

- The user can click a detected region in the preview.
- The application resolves the clicked pixel to a stable region ID.
- The user can change the region's target color, phase, or assignment.
- All previews and exports update after a correction.

### Rendering strategy

The application uses a hybrid rendering strategy:

1. **Exact Guide:** deterministic mask-based rendering is the source of truth.
2. **AI Marker Preview:** optional masked inpainting produces realistic marker shading.

The AI-generated preview must never replace the exact guide. Diffusion can change line
art, shift colors, or invent details, so generated output is always presented as an
artistic preview.

## Definition of Done

A user can:

1. Upload an empty coloring page and optional inspiration images.
2. Generate a color plan using the local vision model.
3. See universal target colors and secondary Ohuhu marker matches.
4. Step through cumulative base, shadow, highlight, and accent images.
5. See deterministic colors constrained to detected regions rather than rectangles.
6. Click a region and correct its assignment, target color, or phase.
7. Save and reopen projects in the browser.
8. Export a final PNG, one PNG per phase, and a printable PDF.
9. Optionally request an AI-shaded alcohol-marker preview.

## Quality Gates

Implementation must stop at a failed quality gate and improve the relevant earlier
steps before adding more features.

### Gate 1: Segmentation

Test at least five representative, legally usable coloring pages.

- Major enclosed areas do not visibly bleed across line boundaries.
- Stable region IDs survive label-map encoding and decoding.
- Tiny noise regions are filtered without deleting important details.
- Open or imperfect lines produce a visible review state instead of silent failure.

### Gate 2: Automatic planning

- At least 80% of important regions receive a sensible automatic assignment on the
  fixture set.
- Every returned region ID exists in the segmentation result.
- Significant omitted regions are reported as unassigned.
- Malformed vision-model output results in an explicit error or bounded retry.

### Gate 3: Rendering

- Selecting one region affects only that region.
- Previous phases remain pixel-stable when later phases are rendered.
- Original line art remains visible above deterministic colors.
- Browser previews and high-resolution exports use the same assignments and phase
  ordering.

### Gate 4: AI preview

- Inpainting changes only the requested mask.
- Previously completed regions remain stable between phases.
- The original line art is reapplied after generation.
- Generated colors remain recognizably close to their target colors.
- The interface clearly distinguishes exact guides from AI previews.

## Proposed Architecture

```text
coloring-app/
├── index.html
├── styles.css
├── js/
│   ├── app.js
│   ├── api.js
│   ├── state.js
│   ├── renderer.js
│   ├── editor.js
│   ├── storage.js
│   └── exports.js
├── backend/
│   ├── app/
│   │   ├── main.py
│   │   ├── config.py
│   │   ├── models.py
│   │   ├── image_normalization.py
│   │   ├── segmentation.py
│   │   ├── label_map.py
│   │   ├── reference_palette.py
│   │   ├── marker_matching.py
│   │   ├── vision_client.py
│   │   ├── analysis.py
│   │   ├── deterministic_renderer.py
│   │   └── exports.py
│   ├── tests/
│   └── requirements.txt
├── diffusion/
│   ├── app/
│   │   ├── main.py
│   │   ├── pipeline.py
│   │   ├── model_lifecycle.py
│   │   └── postprocessing.py
│   ├── tests/
│   └── requirements.txt
├── fixtures/
├── palette.json
└── README.md
```

### Frontend

The existing browser application remains dependency-light and uses ES modules without
a bundler. It handles uploads, project state, canvas rendering, correction tools,
IndexedDB persistence, and downloads.

### Analysis backend

A local Python/FastAPI service handles image normalization, segmentation, palette
extraction, vision-model requests, marker matching, high-resolution deterministic
rendering, and document exports.

The backend is stateless. It must not add a server database.

### Vision model

The existing Gemma 3 vision server identifies objects and creates the artistic plan.
It acts as a planner, not as the segmentation engine.

Configuration such as endpoint URL, model name, timeouts, and image limits comes from
environment variables rather than hard-coded frontend constants.

### Diffusion worker

The optional local diffusion service performs controlled inpainting. For an RTX 4060
with 8 GB VRAM, begin with an SD 1.5 inpainting model and a line-art ControlNet in FP16.
Use attention slicing or CPU offload if needed.

Gemma and the diffusion pipeline should run sequentially when they cannot fit in VRAM
together:

```text
Run Gemma analysis
→ release or unload Gemma GPU resources
→ load the inpainting pipeline
→ generate previews
→ unload the inpainting pipeline when idle
```

The exact model remains replaceable behind the diffusion service API.

## Core Data Contract

The analysis result should contain at least:

```json
{
  "projectVersion": 1,
  "image": {
    "width": 1200,
    "height": 1600
  },
  "theme": "Example theme",
  "mood": "Example mood",
  "description": "Why the scheme suits the page",
  "labelMap": {
    "encoding": "png-region-id-rgb",
    "dataUrl": "data:image/png;base64,..."
  },
  "regions": [
    {
      "id": 1,
      "area": 12345,
      "centroid": { "x": 0.5, "y": 0.4 },
      "box": { "x": 0.3, "y": 0.2, "width": 0.4, "height": 0.5 }
    }
  ],
  "assignments": [
    {
      "regionIds": [1],
      "description": "Main flower petals",
      "phase": "base",
      "targetHex": "#d95f76",
      "reason": "Creates a warm focal point",
      "markerMatch": {
        "code": "R412",
        "name": "Cerise",
        "hex": "#ce506a",
        "deltaE": 4.2
      }
    }
  ],
  "unassignedRegionIds": []
}
```

The final schema may add fields, but these invariants must remain:

- Region IDs are stable integers.
- Coordinates are normalized from zero to one.
- `targetHex` remains the universal artistic color.
- `markerMatch` is derived and secondary.
- A phase is one of `base`, `shadow`, `highlight`, or `accent`.
- Significant regions are assigned or explicitly listed as unassigned.

## Implementation Chunks

Each chunk is deliberately bounded so it can be assigned to a smaller model. Give one
chunk at a time. Require the model to inspect relevant existing code, preserve
unrelated work, implement only the requested scope, run focused validation, and report
the files it changed.

### Phase A: Foundation and exact region rendering

#### Chunk 1: Establish fixtures and API contracts

**Dependencies:** None

- Add 5–10 representative, legally usable or programmatically generated coloring-page
  fixtures.
- Include simple synthetic fixtures such as a closed circle, adjacent shapes, nested
  shapes, a small line gap, and anti-aliased line art.
- Document example analysis request and response payloads.
- Define image dimensions, stable region IDs, label-map encoding, phases, target
  colors, marker matches, and unassigned regions.
- Do not implement the backend or refactor the frontend yet.

**Validation:**

- All JSON examples parse successfully.
- No copyrighted fixture is added without permission.
- The current prototype still runs unchanged.

#### Chunk 2: Scaffold the local analysis backend

**Dependencies:** Chunk 1

- Add the FastAPI application and dependency manifest.
- Add `/api/health`.
- Add local-development CORS configuration.
- Load AI URL, model, timeout, upload limit, and allowed frontend origins from
  environment variables.
- Add explicit startup and configuration errors.

**Validation:**

- A focused test verifies `/api/health`.
- The service starts using the documented command.
- No AI model is required for the health endpoint.

#### Chunk 3: Normalize uploaded line art

**Dependencies:** Chunk 2

- Correct EXIF orientation.
- Convert supported inputs to RGB.
- Enforce file-size and pixel-count limits.
- Normalize contrast and create a grayscale working image.
- Add adaptive thresholding suitable for black or gray line art on a light background.
- Reject invalid images with explicit API errors.

**Validation:**

- Unit tests cover rotated images, grayscale images, transparency, invalid files, and
  oversized files.
- The original-resolution image remains available for final exports.

#### Chunk 4: Detect enclosed regions

**Dependencies:** Chunk 3

- Detect connected light regions separated by line art.
- Apply conservative morphological closing for small gaps.
- Filter noise using configurable absolute and relative area thresholds.
- Assign stable numeric IDs in deterministic order.
- Preserve useful metadata such as area, centroid, and bounding box.

**Validation:**

- Synthetic tests cover closed, adjacent, nested, tiny, and slightly open shapes.
- Running the same input twice produces the same region IDs.
- Important fixture regions are not merged without being flagged.

#### Chunk 5: Encode and decode the region label map

**Dependencies:** Chunk 4

- Encode every retained region into one lossless PNG.
- Map RGB pixel values deterministically to integer region IDs.
- Reserve a value for line art and another value for background/unassigned pixels.
- Implement matching browser-side decoding.
- Document the encoding limit and reject impossible IDs explicitly.

**Validation:**

- A round-trip test preserves every region ID.
- Anti-aliased resizing is never applied to the label map.
- Browser decoding resolves known test pixels correctly.

#### Chunk 6: Prove exact mask-based browser rendering

**Dependencies:** Chunk 5

- Replace rectangle overlays for one hard-coded test plan with label-map compositing.
- Fill only pixels belonging to assigned region IDs.
- Preserve original black line art above the colors.
- Use one shared render function for the main canvas and thumbnails.
- Do not integrate AI analysis yet.

**Validation:**

- Selecting one region colors only that region.
- Later phases do not alter pixels from earlier phases.
- The segmentation quality gate passes on the fixture set before continuing.

### Phase B: Palette and automatic artistic planning

#### Chunk 7: Extract inspiration palettes

**Dependencies:** Chunk 3

- Accept zero or more optional inspiration images.
- Extract a small weighted palette from the combined references.
- Exclude near-white backgrounds, near-black noise, and insignificant clusters.
- Keep reference influence limited to palette inspiration.

**Validation:**

- Tests cover no references, solid colors, gradients, photographs, and dominant white
  backgrounds.
- The result contains normalized six-digit hex values and weights.

#### Chunk 8: Implement perceptual Ohuhu matching

**Dependencies:** Chunk 2

- Load and validate `palette.json` in the backend.
- Convert target and marker colors to Lab.
- Select the nearest marker using CIEDE2000.
- Return code, name, marker hex, and Delta E.
- Never overwrite the universal target hex.

**Validation:**

- Exact marker colors have zero or near-zero distance.
- Invalid palette entries fail explicitly.
- Known sample colors return sensible marker matches.

#### Chunk 9: Move vision access behind the backend

**Dependencies:** Chunk 2

- Implement a typed client for the existing OpenAI-compatible Gemma endpoint.
- Add timeout and connection error handling.
- Validate the response envelope before parsing content.
- Allow one bounded retry for malformed JSON.
- Remove direct browser-to-AI communication only after the backend route works.

**Validation:**

- Tests mock success, timeout, HTTP failure, empty content, and malformed JSON.
- The frontend no longer needs the AI server to support browser CORS.

#### Chunk 10: Generate annotated region images

**Dependencies:** Chunk 5

- Create a vision-model input image showing the original page with readable region IDs.
- Place labels near region centroids without covering excessive line art.
- Omit or group labels for regions too small to label legibly.
- Keep the unannotated original available to the model as separate context.

**Validation:**

- Output dimensions and orientation match the normalized page.
- Major regions have readable and correct IDs.
- Tiny-region handling is deterministic.

#### Chunk 11: Define the strict artistic-plan schema

**Dependencies:** Chunks 7, 8, and 10

- Define typed models for theme, mood, description, assignments, region IDs, target
  colors, reasons, and phases.
- Restrict phases to the four canonical values.
- Reject unknown region IDs, invalid colors, empty descriptions, and duplicate
  assignment conflicts.
- Support one assignment containing multiple related region IDs.

**Validation:**

- Tests cover valid plans and every important invalid condition.
- Parsing never silently invents region IDs or colors.

#### Chunk 12: Generate the automatic artistic plan

**Dependencies:** Chunks 9 and 11

- Prompt Gemma with the original page, annotated-region image, and optional extracted
  inspiration palette.
- Ask Gemma to reference region IDs rather than bounding boxes.
- Request a clear focal point, cohesive palette, and useful base/shadow/highlight/accent
  progression.
- Validate the result before marker matching.
- Add the secondary Ohuhu match to each target color.

**Validation:**

- A mocked integration test produces a valid complete result.
- Returned region IDs are known.
- Universal colors survive marker matching unchanged.

#### Chunk 13: Handle missing and conflicting assignments

**Dependencies:** Chunk 12

- Detect significant regions omitted by Gemma.
- Detect regions assigned conflicting colors or phases.
- Preserve unresolved regions in an explicit review list.
- Apply a fallback only when it is documented and visibly marked for review.
- Never silently discard a significant detected region.

**Validation:**

- Tests cover partial, duplicate, conflicting, and empty AI plans.
- The frontend can distinguish complete and needs-review results.

#### Chunk 14: Build the complete `/api/analyze` pipeline

**Dependencies:** Chunks 4–13

- Add multipart upload for one page and optional inspiration images.
- Orchestrate normalization, segmentation, reference palette extraction, annotation,
  Gemma analysis, schema validation, marker matching, and response serialization.
- Return meaningful stage-specific errors.

**Validation:**

- An integration test runs against a mocked Gemma server.
- Invalid uploads and upstream failures return non-success status codes.
- The automatic-planning quality gate passes before continuing.

### Phase C: Frontend workflow and corrections

#### Chunk 15: Modularize frontend state and API access

**Dependencies:** Chunk 14

- Split the monolithic script into small ES modules without introducing a bundler.
- Add one central project-state structure.
- Add a dedicated API module.
- Preserve existing upload, analysis, and display behavior during the transition.
- Stop any active playback interval when a project changes.

**Validation:**

- The browser loads without console errors.
- Existing behavior still works against the new backend.
- State is not duplicated across unrelated modules.

#### Chunk 16: Add optional inspiration uploads

**Dependencies:** Chunk 15

- Support multiple inspiration images.
- Show thumbnails and allow removal before analysis.
- Display clear file-count and file-size limits.
- Keep page-only analysis fully supported.
- Send references through the multipart analysis request.

**Validation:**

- The request contains the page exactly once and the selected references.
- Removing a thumbnail removes that file from the request.
- Empty-reference analysis works.

#### Chunk 17: Render cumulative artistic phases

**Dependencies:** Chunks 6 and 15

- Render Original, Base, Shadows, Highlights, and Accents.
- Group assignments by canonical phase.
- Use the same renderer for the main canvas, thumbnails, and subsequent exports.
- Update previous, next, play, pause, and selected-step controls.
- Remove the old rectangle rendering.

**Validation:**

- Every phase is cumulative.
- Playback ends cleanly and can be restarted.
- Thumbnail and main-canvas pixels agree at equivalent resolution.

#### Chunk 18: Display universal and marker colors clearly

**Dependencies:** Chunk 17

- Present the universal target color as the primary recommendation.
- Present the Ohuhu code, name, marker hex, and distance as secondary information.
- Explain when the nearest marker is a visibly imperfect match.
- Keep phase, region description, and artistic reason visible.

**Validation:**

- Users cannot confuse the marker approximation with the target color.
- All displayed values come from validated analysis data.

#### Chunk 19: Implement click-to-reassign

**Dependencies:** Chunk 17

- Convert canvas clicks through display scaling into label-map coordinates.
- Resolve the clicked pixel to a stable region ID.
- Show the current assignment in a compact editor.
- Allow target color, phase, and semantic assignment changes.
- Recompute the Ohuhu match through the backend.
- Re-render all affected phases immediately.

**Validation:**

- Clicks resolve correctly on scaled and high-DPI canvases.
- Clicking line art or background does not edit an unrelated region.
- Corrections survive navigation between phases.

#### Chunk 20: Add the plan-review workflow

**Dependencies:** Chunk 19

- List unassigned, conflicting, or suspiciously small regions.
- Make review entries clickable.
- Highlight the selected region on the canvas without modifying project colors.
- Mark reviewed items explicitly.
- Allow regeneration without losing user corrections unless the user confirms.

**Validation:**

- Every backend review item is reachable in the UI.
- Selection highlighting does not leak into exports.

#### Chunk 21: Persist projects in IndexedDB

**Dependencies:** Chunk 19

- Save the page blob, optional reference blobs, analysis response, label map, and user
  overrides.
- Add create, list, open, rename, and delete operations.
- Version the stored project schema.
- Handle corrupt or outdated projects with a visible recovery error.
- Do not add a backend database.

**Validation:**

- A corrected project renders identically after browser reload.
- Deleting one project does not affect others.
- Unsupported schema versions are not opened silently.

### Phase D: Deterministic high-resolution output

#### Chunk 22: Implement high-resolution backend rendering

**Dependencies:** Chunk 14

- Render assignments from the original-resolution page and label map using Pillow or an
  equivalent deterministic library.
- Preserve line art above colored regions.
- Render any requested cumulative phase.
- Use the same canonical phase order as the browser.
- Add restrained procedural marker texture, edge darkening, or highlights only when
  deterministic and configurable.

**Validation:**

- Pixel tests prove that color does not cross mask boundaries.
- Previous-phase pixels remain stable in later output.
- Backend and browser rendering agree on region membership and assignment.

#### Chunk 23: Export required files

**Dependencies:** Chunk 22

- Export the final deterministic PNG.
- Export one deterministic PNG for each phase.
- Generate a printable PDF with theme, palette, universal colors, marker matches,
  instructions, and phase images.
- Prefer one ZIP containing all PNGs plus the PDF while retaining direct PDF download.
- Include project metadata sufficient to identify the export.

**Validation:**

- Every exported file opens successfully.
- PNG dimensions match the original page unless the user requests scaling.
- The PDF remains legible on standard page sizes.

### Phase E: Optional AI alcohol-marker preview

#### Chunk 24: Add a procedural marker-style renderer

**Dependencies:** Chunk 22

- Improve deterministic fills with subtle paper texture, controlled stroke variation,
  edge darkening, and phase-appropriate highlights.
- Keep the effect reproducible from a fixed project seed.
- Never alter line-art pixels or region membership.
- Add an intensity control and an exact-flat-fill option.

**Validation:**

- Identical inputs and seeds produce identical pixels.
- Effects remain inside masks.
- The flat exact guide remains available.

#### Chunk 25: Scaffold the diffusion worker

**Dependencies:** Chunk 6

- Add a separate local service for masked inpainting.
- Define health, model status, load, unload, and generate operations.
- Keep the model implementation replaceable.
- Start with an SD 1.5 inpainting pipeline and line-art ControlNet suitable for 8 GB
  VRAM.
- Add FP16, attention slicing, and optional CPU offload configuration.

**Validation:**

- Health and model-status endpoints work without a loaded model.
- Load failure and out-of-memory errors are explicit.
- The service can release GPU memory through its unload operation.

#### Chunk 26: Coordinate GPU model lifecycle

**Dependencies:** Chunks 9 and 25

- Prevent Gemma analysis and diffusion generation from competing for insufficient VRAM.
- Add a documented sequential lifecycle.
- Detect unavailable or busy services.
- Add timeouts and cancellation where the underlying server supports them.
- Keep deterministic rendering usable when diffusion is unavailable.

**Validation:**

- The application recovers after a failed model load.
- Diffusion failure never destroys the exact project or guide.
- GPU resources are released after configured idle time.

#### Chunk 27: Implement constrained masked inpainting

**Dependencies:** Chunks 17 and 25

- Generate only inside newly introduced phase masks.
- Use the original line art as ControlNet guidance.
- Use a stable project seed, prompt, dimensions, and generation settings.
- Composite pixels outside the requested mask from the previous exact or generated
  phase.
- Do not generate each thumbnail independently.

**Validation:**

- Pixels outside the inpaint mask are unchanged.
- Repeating a request with identical inputs is acceptably stable.
- Earlier regions do not drift as later phases are added.

#### Chunk 28: Preserve lines and correct generated colors

**Dependencies:** Chunk 27

- Reapply the original line art above generated output.
- Correct generated mask colors toward their requested target colors without removing
  all texture and shading.
- Preserve luminance variation while reducing excessive hue drift.
- Record generation settings and seed with the project.

**Validation:**

- Lines remain at least as clear as in the deterministic preview.
- Generated areas remain recognizably close to target colors.
- Postprocessing changes only relevant masks and line-art pixels.

#### Chunk 29: Add exact/AI preview controls

**Dependencies:** Chunk 28

- Add a clear switch between Exact Guide and AI Marker Preview.
- Label AI output as an artistic approximation.
- Show generation progress, cancellation, errors, seed, and regenerate controls.
- Cache successful generated phases in the current project.
- Allow deterministic downloads even when no AI preview exists.

**Validation:**

- Users always know which rendering mode they are viewing.
- Switching modes does not change assignments.
- Cached previews reopen with a saved project.

#### Chunk 30: Validate cross-step AI consistency

**Dependencies:** Chunk 29

- Measure and inspect changes outside each phase mask.
- Test multiple fixture pages, seeds, phases, and target palettes.
- Tune denoising strength, ControlNet weight, mask padding, and color correction.
- Document known limitations such as texture drift or imperfect marker simulation.

**Validation:**

- The AI-preview quality gate passes.
- Failed consistency checks disable or warn on the affected preview rather than
  presenting it as exact.

### Phase F: Hardening and completion

#### Chunk 31: Improve errors, progress, and cancellation

**Dependencies:** Chunks 14, 23, and 29

- Show progress by stage: upload, segmentation, palette extraction, planning,
  rendering, and optional generation.
- Make backend, Gemma, diffusion, validation, and export failures distinguishable.
- Add cancellation where practical.
- Restore controls correctly after every success, failure, or cancellation.

**Validation:**

- Simulated failures leave the application in a usable state.
- Errors are explicit and do not appear as successful empty results.

#### Chunk 32: Accessibility and responsive behavior

**Dependencies:** Chunk 31

- Make all controls keyboard accessible.
- Add visible focus styles.
- Add text alternatives and textual region/phase summaries for canvases.
- Ensure color information is not communicated through color alone.
- Test narrow screens and high zoom levels.

**Validation:**

- Core workflow is usable with a keyboard.
- Controls retain readable labels and contrast.
- Mobile layout has no inaccessible horizontal overflow.

#### Chunk 33: End-to-end validation

**Dependencies:** Chunks 21, 23, 31, and 32

- Test upload through automatic analysis.
- Test phase rendering and correction.
- Test save, reload, and delete.
- Test deterministic exports.
- Test optional AI generation and graceful fallback.
- Cover malformed AI responses, open line gaps, many tiny regions, no references,
  unavailable services, oversized files, and corrupted saved projects.

**Validation:**

- All focused unit and integration tests pass.
- The complete workflow passes manually on the representative fixture set.
- All four quality gates are recorded as passing or have documented blockers.

#### Chunk 34: Complete documentation

**Dependencies:** Chunk 33

- Document Python setup and dependency installation.
- Document frontend, analysis backend, Gemma server, and diffusion worker launch
  commands.
- Document environment variables and example configuration.
- Explain GPU lifecycle for the RTX 4060 8 GB target.
- Explain project privacy and local storage.
- Add troubleshooting for CORS, unavailable AI servers, malformed model output,
  segmentation problems, and GPU out-of-memory errors.
- Document known segmentation and AI-preview limitations.

**Validation:**

- A clean local setup can be completed using only the README.
- Every documented command has been run successfully.

## Instructions for Models Implementing a Chunk

Use this wrapper when assigning any chunk:

> Work in `/home/dennis/coloring-app`. Implement only chunk N from
> `IMPLEMENTATION_PLAN.md`. Read the chunk, its dependencies, and the relevant existing
> code before editing. Preserve unrelated and uncommitted work. Follow existing
> conventions, add focused tests for the chunk's acceptance criteria, and run the
> smallest validation that proves the change. Do not implement future chunks or perform
> unrelated refactoring. Report the behavior added, files changed, tests run, and any
> blocker that prevents the acceptance criteria from passing.

## Rules That Apply to Every Chunk

- Preserve the uploaded line art; do not recreate the coloring page with generative AI.
- Treat segmentation masks and stable region IDs as the source of truth.
- Treat Gemma as an artistic planner, not as a pixel-segmentation engine.
- Treat diffusion output as optional and approximate.
- Do not regenerate each phase independently.
- Keep previously completed pixels stable between phases.
- Reapply original line art after generated rendering.
- Keep universal target colors separate from approximate marker matches.
- Never silently ignore malformed AI responses or significant unassigned regions.
- Do not add a backend database.
- Keep deterministic guide generation available when every AI service is offline.
- Add only the dependencies required by the current chunk.
- Stop after the current chunk's acceptance criteria pass.

## Suggested Milestones

### Milestone 1: Accurate region coloring

Chunks 1–6. Do not proceed until segmentation and exact mask rendering pass Gate 1.

### Milestone 2: Automatic color plan

Chunks 7–14. Do not proceed until automatic plans pass Gate 2.

### Milestone 3: Usable editable guide

Chunks 15–21. Users can upload, review, correct, and save projects.

### Milestone 4: Complete deterministic product

Chunks 22–24. All required exports work without diffusion.

### Milestone 5: Optional realistic marker previews

Chunks 25–30. Controlled inpainting adds polish without compromising the guide.

### Milestone 6: Reliable local release

Chunks 31–34. Errors, accessibility, end-to-end tests, and setup documentation are
complete.

## Repository State Before Starting

At the time this plan was created, the worktree contained uncommitted changes in
`app.js`, `index.html`, and `styles.css`, plus an untracked `README.md`.

Checkpoint or otherwise preserve that work before assigning implementation chunks.
Do not reset or overwrite it.
