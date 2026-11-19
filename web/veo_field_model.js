// geometry for tools/veo_field_clicker.html: click cones on a downloaded Veo video, then click anywhere on the
// field and read its (x, y). pure functions, no DOM, so the page and the node checks run the same code.
//
// a homography between Veo PIXELS and the field does not exist: the file holds two lenses with strong
// distortion and a two-zone row packing. so every pixel is first turned into the RAY it looks along (Veo's own
// per-match lens model, tools/veo_view_model.js), and the homography is fitted between ray directions and field
// points: field (x, y, 1) is proportional to H times the direction, exactly, for any camera with one centre and
// at any field of view. the two lens centres are 3 inches apart and are treated as one.
//
// frames: the RIG frame is x right, y down, z forward (the .veo file's). the FIELD frame is Wes's stats app's:
// x = 0 on end zone A's back line, y = 0 on one sideline, in yards.
(function (root) {
  const VeoView = root.VeoView || require('./veo_view_model.js');
  const ROWS = 1024;
  const COLUMNS = 2048;
  const HORIZONTAL_SCALE = 3840 / 2048;
  const METRES_PER_YARD = 0.9144;
  // how a 1024-row half maps to the 2160 native sensor rows is not in the .veo file: it is a constant of Veo's
  // panorama format, written in Veo's own player shader (getImage, "Handle src compression", read 2026-11-13 from
  // cdn.app.veo.co/assets/player-*.js, the same in all five lens shaders): the top 19/45 of the native rows fill
  // the top 19/32 of the half, the rest fills the rest. that is 1.5 native rows per row down to row 608 and 3.0
  // below it. the Shipwreck calibration had measured 1.5, 606.7 and 2.99 from clicks (docs/m3-field-locations.md)
  const NATIVE_ROWS = 2160;
  const TOP_NATIVE_FRACTION = 19 / 45;
  const TOP_HALF_FRACTION = 19 / 32;
  const VEO_ROW_PACKING = {top_scale: (NATIVE_ROWS * TOP_NATIVE_FRACTION) / (ROWS * TOP_HALF_FRACTION), knee_row: ROWS * TOP_HALF_FRACTION,
                           bottom_scale: (NATIVE_ROWS * (1 - TOP_NATIVE_FRACTION)) / (ROWS * (1 - TOP_HALF_FRACTION))};
  // the rational distortion model is only trusted this far off a lens axis (python's VeoRig.project)
  const MAXIMUM_RADIUS_SQUARED = 4.0;
  const MINIMUM_DEPTH_FRACTION = 0.05;
  // where the two lenses overlap, each is weighted by its distance from its own image edge, up to this many pixels
  const FEATHER_PIXELS = 64;
  const CONE_NAMES = ['A_back_far', 'A_back_near', 'A_goal_far', 'A_goal_near', 'B_goal_far', 'B_goal_near', 'B_back_far', 'B_back_near'];

  const numbers = text => text.split(',').map(Number);
  const reshape = (values, columns) => Array.from({length: values.length / columns}, (_, row) => values.slice(row * columns, (row + 1) * columns));

  // ---- the lens model ----

  // Veo's per-match lens file (.veo, calibration_version 6.2), as src/calibration/veo_calibration.py reads it
  function lensFromVeoFile(record) {
    if (record.calibration_version !== '6.2') throw Error(`Unknown .veo calibration version ${record.calibration_version}`);
    const alignment = record.alignment;
    const distortions = ['left', 'right'].map(side => {
      const coefficients = numbers(alignment[`distortion_${side}`]);
      if (coefficients.slice(8).some(value => value !== 0)) throw Error('Thin-prism or tilt distortion terms are not supported');
      return coefficients.slice(0, 8);
    });
    return {horizontalScale: HORIZONTAL_SCALE, verticalMapping: {...VEO_ROW_PACKING},
            verticalMappingSource: "Veo's own (from its player)",
            cameraMatrices: ['left', 'right'].map(side => reshape(numbers(alignment[`intrinsic_${side}`]), 3)),
            distortions, lensToRig: ['left', 'right'].map(side => reshape(numbers(alignment[`lens_${side}2camera`]), 4))};
  }

  // a posed rig written by sanity/calibration/12_veo_own_calibration.py: its lens block and its own fitted rows
  function lensFromCalibration(record) {
    if (record.schema !== 'ultimate-tracker/veo-rig/1') throw Error(`Not a Veo rig calibration (${record.schema})`);
    return {horizontalScale: record.horizontal_scale, verticalMapping: record.vertical_mapping,
            verticalMappingSource: 'fitted for this game (calibration_veo.json)',
            cameraMatrices: record.lens.camera_matrices, distortions: record.lens.distortions, lensToRig: record.lens.lens_to_rig};
  }

  function lensFromRecord(record) {
    return record.calibration_version !== undefined ? lensFromVeoFile(record) : lensFromCalibration(record);
  }

  // ---- small linear algebra ----

  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const scaled = (a, factor) => a.map(value => value * factor);
  const unit = a => scaled(a, 1 / Math.hypot(...a));
  const apply = (matrix, vector) => matrix.map(row => dot(row, vector));
  const applyTransposed = (matrix, vector) => [0, 1, 2].map(column => matrix[0][column] * vector[0] + matrix[1][column] * vector[1] + matrix[2][column] * vector[2]);
  const transposed = matrix => [0, 1, 2].map(row => [0, 1, 2].map(column => matrix[column][row]));
  const product = (a, b) => a.map(row => [0, 1, 2].map(column => row[0] * b[0][column] + row[1] * b[1][column] + row[2] * b[2][column]));
  const column = (matrix, index) => matrix.map(row => row[index]);
  const block = transform => transform.slice(0, 3).map(row => row.slice(0, 3));
  const translation = transform => transform.slice(0, 3).map(row => row[3]);

  function inverse(m) {
    const cofactors = [cross(m[1], m[2]), cross(m[2], m[0]), cross(m[0], m[1])];
    const determinant = dot(m[0], cofactors[0]);
    if (!(Math.abs(determinant) > 0)) throw Error('Singular matrix');
    return transposed(cofactors).map(row => scaled(row, 1 / determinant));
  }

  // eigenvalues (ascending) and eigenvectors of a symmetric matrix, by cyclic Jacobi rotations
  function symmetricEigen(matrix) {
    const size = matrix.length;
    const a = matrix.map(row => row.slice());
    const vectors = a.map((_, row) => a.map((__, col) => (row === col ? 1 : 0)));
    for (let sweep = 0; sweep < 100; sweep++) {
      let off = 0;
      for (let p = 0; p < size; p++) for (let q = p + 1; q < size; q++) off += a[p][q] * a[p][q];
      if (off < 1e-30) break;
      for (let p = 0; p < size; p++) {
        for (let q = p + 1; q < size; q++) {
          if (Math.abs(a[p][q]) < 1e-300) continue;
          const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
          const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
          const c = 1 / Math.sqrt(t * t + 1);
          const s = t * c;
          for (let k = 0; k < size; k++) {
            const akp = a[k][p], akq = a[k][q];
            a[k][p] = c * akp - s * akq;
            a[k][q] = s * akp + c * akq;
          }
          for (let k = 0; k < size; k++) {
            const apk = a[p][k], aqk = a[q][k];
            a[p][k] = c * apk - s * aqk;
            a[q][k] = s * apk + c * aqk;
          }
          for (let k = 0; k < size; k++) {
            const vkp = vectors[k][p], vkq = vectors[k][q];
            vectors[k][p] = c * vkp - s * vkq;
            vectors[k][q] = s * vkp + c * vkq;
          }
        }
      }
    }
    const order = a.map((_, index) => index).sort((i, j) => a[i][i] - a[j][j]);
    return {values: order.map(index => a[index][index]), vectors: order.map(index => vectors.map(row => row[index]))};
  }

  // ---- the field and its cones ----

  // the field frame is the user's to choose, and two facts about the camera fix it: which end zone is A as seen
  // from the Veo (aSide: 'left' or 'right') and which sideline is y = 0 (yZeroSide: 'far' or 'near'). in Wes's
  // app A is the end by the left-brick camera and y = 0 is the bricks' sideline: at Shipwreck, left and far
  function checkField(field) {
    if (field.aSide !== 'left' && field.aSide !== 'right') throw Error(`aSide must be left or right, not ${field.aSide}`);
    if (field.yZeroSide !== 'far' && field.yZeroSide !== 'near') throw Error(`yZeroSide must be far or near, not ${field.yZeroSide}`);
    if (!(field.length > 2 * field.endzone && field.endzone > 0 && field.width > 0)) throw Error('The field needs a length, a width and an end zone depth');
  }

  // cones are named for the END ZONE they belong to (A or B) and the sideline as seen from the Veo (near = its own)
  function conePositions(field) {
    checkField(field);
    const far = field.yZeroSide === 'far' ? 0 : field.width;
    const near = field.width - far;
    return {A_back_far: {x: 0, y: far}, A_back_near: {x: 0, y: near},
            A_goal_far: {x: field.endzone, y: far}, A_goal_near: {x: field.endzone, y: near},
            B_goal_far: {x: field.length - field.endzone, y: far}, B_goal_near: {x: field.length - field.endzone, y: near},
            B_back_far: {x: field.length, y: far}, B_back_near: {x: field.length, y: near}};
  }

  // the lines worth drawing back on the video: the outline, both goal lines, and the brick marks as short ticks
  function fieldLines(field) {
    const {length, width, endzone} = field;
    const lines = [[[0, 0], [length, 0]], [[0, width], [length, width]], [[0, 0], [0, width]], [[length, 0], [length, width]],
                   [[endzone, 0], [endzone, width]], [[length - endzone, 0], [length - endzone, width]]];
    return lines.map(([start, end]) => ({start: {x: start[0], y: start[1]}, end: {x: end[0], y: end[1]}}));
  }

  // ---- the homography on rays ----

  // pairs: [{direction: unit rig-frame ray, ground: {x, y}}], at least four with no three in a line.
  // returns H with ground (x, y, 1) = H direction / (third component), the third component positive on the field
  function fitRayHomography(pairs) {
    if (pairs.length < 4) throw Error('A homography needs at least four cones');
    const centre = {x: pairs.reduce((sum, pair) => sum + pair.ground.x, 0) / pairs.length,
                    y: pairs.reduce((sum, pair) => sum + pair.ground.y, 0) / pairs.length};
    const spread = Math.sqrt(pairs.reduce((sum, pair) => sum + (pair.ground.x - centre.x) ** 2 + (pair.ground.y - centre.y) ** 2, 0) / pairs.length);
    if (!(spread > 0)) throw Error('The cones are all in one place');
    const normal = Array.from({length: 9}, () => Array(9).fill(0));
    for (const pair of pairs) {
      const x = (pair.ground.x - centre.x) / spread;
      const y = (pair.ground.y - centre.y) / spread;
      const d = pair.direction;
      for (const row of [[-d[0], -d[1], -d[2], 0, 0, 0, x * d[0], x * d[1], x * d[2]],
                         [0, 0, 0, -d[0], -d[1], -d[2], y * d[0], y * d[1], y * d[2]]]) {
        for (let i = 0; i < 9; i++) for (let j = 0; j < 9; j++) normal[i][j] += row[i] * row[j];
      }
    }
    const eigen = symmetricEigen(normal);
    // three cones in a line leave a second free direction: the fit is then not determined
    if (eigen.values[1] < 1e-9 * eigen.values[8]) throw Error('These cones do not pin the field down: three of them are in one line');
    const h = eigen.vectors[0];
    // undo the normalisation: ground = spread * normalised + centre
    const normalised = [h.slice(0, 3), h.slice(3, 6), h.slice(6, 9)];
    let homography = product([[spread, 0, centre.x], [0, spread, centre.y], [0, 0, 1]], normalised);
    const depths = pairs.map(pair => dot(homography[2], pair.direction));
    if (depths.every(depth => depth < 0)) homography = homography.map(row => scaled(row, -1));
    else if (!depths.every(depth => depth > 0)) throw Error('These cones cannot all be on the ground in front of the camera: check which cone is which');
    const scale = Math.hypot(...homography.flat());
    return homography.map(row => scaled(row, 1 / scale));
  }

  function directionToField(homography, direction) {
    const [x, y, w] = apply(homography, direction);
    // w is the ray's descent toward the ground: zero at the horizon, negative above it
    if (!(w > 1e-9 * Math.hypot(x, y, w))) return null;
    return {x: x / w, y: y / w};
  }

  // what the homography implies about the camera, as a check on the cones: a true ground homography of a camera
  // with a known lens has only 6 freedoms, the fit has 8. the two spare ones show up as the field's two axes
  // coming out unequal in length (aspect) or not square (skew); and labels mirrored near-for-far put the lens
  // below the ground
  function describeHomography(homography, field) {
    const toRay = inverse(homography);              // columns: field x axis, field y axis, toward the field origin
    const xAxis = column(toRay, 0), yAxis = column(toRay, 1), toOrigin = column(toRay, 2);
    const xLength = Math.hypot(...xAxis), yLength = Math.hypot(...yAxis);
    const scale = Math.sqrt(xLength * yLength);
    // seen from the Veo, "rightward" then "toward the camera" then "up" is a LEFT-handed set of axes; x runs
    // rightward when A is on the left, y runs toward the camera when y = 0 is the far sideline
    checkField(field);
    const handedness = -(field.aSide === 'left' ? 1 : -1) * (field.yZeroSide === 'far' ? 1 : -1);
    const up = scaled(unit(cross(xAxis, yAxis)), handedness);
    const heightYards = -dot(toOrigin, up) / scale;
    return {heightYards, heightFeet: heightYards * 3,
            cameraX: -dot(toOrigin, xAxis) / (xLength * xLength), cameraY: -dot(toOrigin, yAxis) / (yLength * yLength),
            aspect: xLength / yLength, skewDegrees: Math.asin(dot(xAxis, yAxis) / (xLength * yLength)) * 180 / Math.PI,
            down: scaled(up, -1)};
  }

  // ---- the rig's turn over the game (optional; src/calibration/veo_drift.py) ----

  // the trusted dense samples of a veo_drift.json, as python's load_drift builds them
  function driftFromRecord(record) {
    if (record.schema !== 'ultimate-tracker/veo-drift/1') throw Error(`Not a Veo drift file (${record.schema})`);
    if (!record.dense) throw Error('This drift file has keyframe samples only, which alias the mast sway');
    const referenceSeconds = record.reference.veo_seconds;
    const samples = [];
    record.dense.frame_index.forEach((frame, index) => {
      const seconds = frame / record.frame_rate;
      if (record.dense.trusted[index] && Math.abs(seconds - referenceSeconds) > 1e-6) samples.push([seconds, record.dense.rotation_vectors_rad[index]]);
    });
    samples.push([referenceSeconds, [0, 0, 0]]);
    samples.sort((a, b) => a[0] - b[0]);
    return {seconds: samples.map(sample => sample[0]), rotationVectors: samples.map(sample => sample[1]),
            sampleInterval: record.dense.frame_stride / record.frame_rate, maximumGap: 1.0, frameRate: record.frame_rate};
  }

  // the rig's turn at a Veo second, as a matrix taking a rig-frame direction at that second into the rig frame
  // of the drift's reference frame. with no drift file the rig is taken as fixed
  function turnAt(drift, veoSeconds) {
    if (!drift) return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    return VeoView.rotationMatrix(VeoView.rotationVectorAt(drift, veoSeconds));
  }

  // cones: {name: {u, v, seconds}} in stacked-frame pixels, each at the Veo second it was clicked.
  // returns the homography in the drift's reference frame, plus per-cone misses and the camera it implies
  function fitField(lens, cones, field, drift) {
    const positions = conePositions(field);
    const names = Object.keys(cones).filter(name => cones[name]);
    for (const name of names) if (!positions[name]) throw Error(`Unknown cone ${name}`);
    const pairs = names.map(name => {
      const ray = VeoView.pixelToRigRay(lens, cones[name].u, cones[name].v);
      return {name, direction: apply(turnAt(drift, cones[name].seconds), ray.direction), ground: positions[name]};
    });
    const homography = fitRayHomography(pairs);
    const camera = describeHomography(homography, field);
    if (!(camera.heightYards > 0)) {
      throw Error(`These cones put the camera below the ground: near and far (or A and B) are swapped, or end zone A is not on the Veo's ${field.aSide} with y = 0 on the ${field.yZeroSide} sideline`);
    }
    const misses = {};
    for (const pair of pairs) {
      const found = directionToField(homography, pair.direction);
      misses[pair.name] = Math.hypot(found.x - pair.ground.x, found.y - pair.ground.y);
    }
    return {homography, camera, misses, coneCount: pairs.length};
  }

  function homographyAt(fit, drift, veoSeconds) {
    return product(fit.homography, turnAt(drift, veoSeconds));
  }

  // stacked-frame pixel at a Veo second -> field (x, y) in yards, or null at or above the horizon
  function pixelToField(lens, fit, drift, veoSeconds, u, v) {
    return directionToField(homographyAt(fit, drift, veoSeconds), VeoView.pixelToRigRay(lens, u, v).direction);
  }

  // field point -> unit rig-frame direction from the rig centre at a Veo second
  function fieldToDirection(fit, drift, veoSeconds, point) {
    return unit(apply(inverse(homographyAt(fit, drift, veoSeconds)), [point.x, point.y, 1]));
  }

  // the ground as the renderer needs it at a Veo second: unit down vector in the rig frame and the lens height
  // in metres, so the two lenses can be lined up on the grass instead of at infinity
  function groundPlaneAt(fit, drift, veoSeconds, field) {
    const camera = describeHomography(homographyAt(fit, drift, veoSeconds), field);
    return {down: camera.down, heightMetres: camera.heightYards * METRES_PER_YARD};
  }

  // ---- one continuous picture from the two lenses ----

  // where a view direction from the rig centre is sampled in each lens: [{lens, u, v, weight}], weights summing
  // to 1, heaviest first; empty where neither lens sees it. with a ground plane, a descending direction is
  // taken to hit the grass and each lens is asked for THAT point, which removes the 3 inch parallax on the
  // ground; otherwise the scene is taken to be far away. the fragment shader in the page does the same sums
  function sampleDirection(lens, direction, groundPlane) {
    let point = null;
    if (groundPlane) {
      const descent = dot(groundPlane.down, direction);
      if (descent > 1e-4) point = scaled(direction, groundPlane.heightMetres / descent);
    }
    const samples = [];
    for (const index of [0, 1]) {
      const origin = translation(lens.lensToRig[index]);
      const fromLens = point ? point.map((value, axis) => value - origin[axis]) : direction;
      const inLens = applyTransposed(block(lens.lensToRig[index]), fromLens);
      if (!(inLens[2] > MINIMUM_DEPTH_FRACTION * Math.hypot(...inLens))) continue;
      const pixel = VeoView.lensPointToPixel(lens, index, inLens);
      if (!pixel || !(pixel.radiusSquared < MAXIMUM_RADIUS_SQUARED)) continue;
      const row = pixel.v - index * ROWS;
      const edge = Math.min(pixel.u, COLUMNS - pixel.u, row, ROWS - row);
      samples.push({lens: index, u: pixel.u, v: pixel.v, weight: Math.min(Math.max(edge / FEATHER_PIXELS, 0.001), 1)});
    }
    const total = samples.reduce((sum, sample) => sum + sample.weight, 0);
    for (const sample of samples) sample.weight /= total;
    return samples.sort((a, b) => b.weight - a.weight);
  }

  // where a stacked-frame pixel is DRAWN: the view direction from the rig centre that shows it
  function pixelToViewDirection(lens, u, v, groundPlane) {
    const ray = VeoView.pixelToRigRay(lens, u, v);
    if (groundPlane) {
      const descent = dot(groundPlane.down, ray.direction);
      if (descent > 1e-4) {
        const distance = (groundPlane.heightMetres - dot(groundPlane.down, ray.origin)) / descent;
        return unit(ray.origin.map((value, axis) => value + distance * ray.direction[axis]));
      }
    }
    return ray.direction;
  }

  // ---- the pan/zoom view ----
  // view: {yaw, pitch (radians; pitch positive looks down), fieldOfView (horizontal, radians), projection,
  // width, height (CSS pixels)}. 'wide' is a cylinder (columns are compass bearing, so the whole 190 degree
  // field fits and verticals stay vertical); 'flat' is an ordinary lens (straight lines stay straight, up to ~120 degrees)

  const LIMITS = {wide: {minimum: 4 * Math.PI / 180, maximum: 230 * Math.PI / 180},
                  flat: {minimum: 4 * Math.PI / 180, maximum: 120 * Math.PI / 180},
                  yaw: 115 * Math.PI / 180, pitchUp: -35 * Math.PI / 180, pitchDown: 80 * Math.PI / 180};

  function focalLength(view) {
    return view.projection === 'flat' ? (view.width / 2) / Math.tan(view.fieldOfView / 2) : view.width / view.fieldOfView;
  }

  // the view's rotation: rig-frame direction = rotation * view-frame direction
  function viewRotation(view) {
    const cy = Math.cos(view.yaw), sy = Math.sin(view.yaw);
    const yawMatrix = [[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]];
    if (view.projection !== 'flat') return yawMatrix;   // the cylinder stays upright: pitch slides it instead
    const cp = Math.cos(view.pitch), sp = Math.sin(view.pitch);
    return product(yawMatrix, [[1, 0, 0], [0, cp, sp], [0, -sp, cp]]);
  }

  function screenToDirection(view, screenX, screenY) {
    const focal = focalLength(view);
    const x = (screenX - view.width / 2) / focal;
    const y = (screenY - view.height / 2) / focal;
    const inView = view.projection === 'flat' ? [x, y, 1] : [Math.sin(x), y + Math.tan(view.pitch), Math.cos(x)];
    return unit(apply(viewRotation(view), inView));
  }

  function directionToScreen(view, direction) {
    const focal = focalLength(view);
    const inView = applyTransposed(viewRotation(view), direction);
    if (view.projection === 'flat') {
      if (!(inView[2] > 1e-6)) return null;
      return {x: view.width / 2 + focal * inView[0] / inView[2], y: view.height / 2 + focal * inView[1] / inView[2]};
    }
    const flat = Math.hypot(inView[0], inView[2]);
    if (!(flat > 1e-9)) return null;
    return {x: view.width / 2 + focal * Math.atan2(inView[0], inView[2]),
            y: view.height / 2 + focal * (inView[1] / flat - Math.tan(view.pitch))};
  }

  function clampView(view) {
    const limits = LIMITS[view.projection];
    if (!limits) throw Error(`Unknown projection ${view.projection}`);
    return {...view, fieldOfView: Math.min(Math.max(view.fieldOfView, limits.minimum), limits.maximum),
            yaw: Math.min(Math.max(view.yaw, -LIMITS.yaw), LIMITS.yaw),
            pitch: Math.min(Math.max(view.pitch, LIMITS.pitchUp), LIMITS.pitchDown)};
  }

  // the whole capture in one picture: both lenses side to side, the field's depth top to bottom
  function wholeView(width, height) {
    return clampView({projection: 'wide', yaw: 0, pitch: 17 * Math.PI / 180, fieldOfView: 200 * Math.PI / 180, width, height});
  }

  // turn the view so that `direction` is drawn at (screenX, screenY); the zoom is left alone
  function aimAt(view, direction, screenX, screenY) {
    let aimed = view;
    for (let step = 0; step < 12; step++) {
      const at = directionToScreen(aimed, direction);
      if (!at) return view;
      const focal = focalLength(aimed);
      const errorX = at.x - screenX, errorY = at.y - screenY;
      if (Math.hypot(errorX, errorY) < 1e-4) break;
      // a small turn moves the picture by about focal * angle (exactly so at the centre of a flat view)
      const pitchGain = aimed.projection === 'flat' ? 1 : Math.cos(aimed.pitch) ** 2;
      aimed = clampView({...aimed, yaw: aimed.yaw + errorX / focal, pitch: aimed.pitch + pitchGain * errorY / focal});
    }
    return aimed;
  }

  // wheel zoom: 1.077 per notch about the cursor, the notch count clamped so a trackpad swipe cannot overshoot
  function zoomAbout(view, screenX, screenY, deltaY) {
    const notches = Math.max(-3, Math.min(3, deltaY / 100));
    const held = screenToDirection(view, screenX, screenY);
    const zoomed = clampView({...view, fieldOfView: view.fieldOfView * Math.pow(1.077, notches)});
    return aimAt(zoomed, held, screenX, screenY);
  }

  // drag: the point picked up stays under the cursor
  function panBy(view, fromX, fromY, toX, toY) {
    return aimAt(view, screenToDirection(view, fromX, fromY), toX, toY);
  }

  // switch between the cylinder and the flat lens, keeping the centre of the picture and its scale there
  function withProjection(view, projection) {
    if (projection === view.projection) return view;
    const centre = screenToDirection(view, view.width / 2, view.height / 2);
    const focal = focalLength(view);
    const fieldOfView = projection === 'flat' ? 2 * Math.atan(view.width / (2 * focal)) : view.width / focal;
    return aimAt(clampView({...view, projection, fieldOfView}), centre, view.width / 2, view.height / 2);
  }

  // ---- the Veo link ----

  // a match URL (https://app.veo.co/matches/<slug>/...) -> its slug and page
  function matchFromUrl(text) {
    const found = /\/matches\/([^/?#\s"'\\]+)/.exec(text || '');
    if (!found) return null;
    return {slug: found[1], matchUrl: `https://app.veo.co/matches/${found[1]}/`};
  }

  // whatever was pasted -> the match, and the two files if their links are in it. Veo serves both from its CDN
  // to any page (measured 2026-11-13: Access-Control-Allow-Origin *, byte ranges, no login), so the page can
  // play the panorama straight from the link. the match's file list needs Veo's login token, which only Veo's
  // own page holds: bookmarkletSource() below reads the two links there
  function linksFromText(text) {
    const urls = (text || '').match(/https?:\/\/[^\s"'<>\\]+/g) || [];
    const path = url => url.split(/[?#]/)[0];
    const videos = urls.filter(url => /\.mp4$/.test(path(url)));
    const videoUrl = videos.find(url => /\/panorama\//.test(url)) || videos.find(url => !/\/standard\//.test(url)) || null;
    return {match: matchFromUrl(text), videoUrl: videoUrl && videoUrl.split('#')[0],
            lensUrl: urls.find(url => /\/[^/]+\.veo$/.test(path(url))) || null,
            // the 1920x1080 follow-cam video is not the two-lens panorama and cannot be used
            followCamOnly: !videoUrl && videos.length > 0};
  }

  // a bookmark to click on a Veo match page: it copies {match, video, lens} for pasting into the clicker. it asks
  // Veo's own API with the login token Veo's page keeps in localStorage (measured 2026-11-18): without the token
  // /videos/ lists only the follow-cam; with it, the panorama too, its render_settings being the .veo lens file
  async function collectVeoLinks() {
    const slug = (/\/matches\/([^/?#]+)/.exec(location.pathname) || [])[1];
    if (!slug) { alert('Open a Veo match page first.'); return; }
    const oidcKey = Object.keys(localStorage).find(key => key.startsWith('oidc.user:'));
    const token = (oidcKey && JSON.parse(localStorage.getItem(oidcKey)).access_token) || localStorage.getItem('auth_token');
    if (!token) { alert('Sign in to Veo on this page first.'); return; }
    const response = await fetch(`/api/app/matches/${slug}/videos/`, {headers: {Authorization: `Bearer ${token}`}});
    if (!response.ok) { alert(`Veo did not list this match's videos (HTTP ${response.status}). Reload the page and try again.`); return; }
    const panorama = (await response.json()).find(video => video.render_type === 'panorama');
    if (!panorama || !panorama.render_settings) { alert('Veo lists no panorama video for this match.'); return; }
    const text = JSON.stringify({match: `${location.origin}/matches/${slug}/`, video: panorama.url.split('#')[0], lens: panorama.render_settings});
    const show = () => prompt('Copy this, then paste it into the Veo field clicker:', text);
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => alert('Copied. Paste it into the Veo field clicker.'), show);
    else show();
  }
  const bookmarkletSource = () => `javascript:(${collectVeoLinks.toString()})()`;

  const VeoField = {CONE_NAMES, FEATHER_PIXELS, MAXIMUM_RADIUS_SQUARED, MINIMUM_DEPTH_FRACTION, VEO_ROW_PACKING, LIMITS,
                    lensFromVeoFile, lensFromCalibration, lensFromRecord, checkField, conePositions, fieldLines, fitRayHomography,
                    directionToField, describeHomography, driftFromRecord, turnAt, fitField, homographyAt, pixelToField,
                    fieldToDirection, groundPlaneAt, sampleDirection, pixelToViewDirection, focalLength, viewRotation,
                    screenToDirection, directionToScreen, clampView, wholeView, aimAt, zoomAbout, panBy, withProjection,
                    matchFromUrl, linksFromText, collectVeoLinks, bookmarkletSource, inverse, product, apply};
  root.VeoField = VeoField;
  if (typeof module !== 'undefined' && module.exports) module.exports = VeoField;
})(typeof window !== 'undefined' ? window : globalThis);
