// geometry for clicking a field location directly on the Veo video: pure functions, no DOM, so the
// page and the node checks run the same code. ports src/calibration/veo_calibration.py (Veo's own
// per-match lens model, posed on the field by sanity/calibration/12_veo_own_calibration.py) and the rig's
// measured turn over the game (src/calibration/veo_drift.py).
//
// the stacked 2048x2048 frame holds the left lens in rows 0-1023, the right in 1024-2047; a half maps to
// native sensor pixels by x 3840/2048 and, vertically, in two zones: 1.5 native rows per row down to a knee near
// row 607, ~2.99 below it (measured; the whole 2160-row sensor fits in 1024 rows). distortion is OpenCV's rational model
// with no tangential terms. the field frame has its origin on the Veo's own sideline; Wes's app has
// y = 0 on the bricks' sideline (the Veo's far side, measured against his record), so app y is the
// far-side distance. lengths are rescaled zone by zone to the app's field, as for the 360 view.
(function (root) {
  const ROWS = 1024;
  const UNDISTORT_ITERATIONS = 100;

  function rigFromCalibration(record) {
    return {rotation: record.rotation_world_from_rig, centre: record.centre_m, field: record.field_metres,
            horizontalScale: record.horizontal_scale, verticalMapping: record.vertical_mapping,
            cameraMatrices: record.lens.camera_matrices, distortions: record.lens.distortions,
            lensToRig: record.lens.lens_to_rig};
  }

  // the rig turns slowly through a game (src/calibration/veo_drift.py): the pose at Veo second t is the
  // clicked pose turned by DELTA(t) in the rig frame, R(t) = R_reference DELTA(t). DELTA is sampled at every
  // keyframe and interpolated linearly in its rotation vector, as python does
  function trackFromCalibration(record, drift) {
    if (!drift || !drift.seconds?.length) throw Error('The Veo calibration needs its measured drift (veo_drift.json)');
    return {reference: rigFromCalibration(record), seconds: drift.seconds, rotationVectors: drift.rotation_vectors_rad,
            sampleInterval: drift.sample_interval_seconds, maximumGap: drift.maximum_interpolation_gap_seconds};
  }

  function rotationVectorAt(track, veoSeconds) {
    const times = track.seconds;
    const last = times.length - 1;
    // keyframe samples end up to one interval before the video does: hold the ends that far, refuse beyond
    if (!(veoSeconds >= times[0] - track.sampleInterval && veoSeconds <= times[last] + track.sampleInterval)) {
      throw Error(`Veo time ${veoSeconds} s is outside the measured drift (${times[0]}-${times[last]} s)`);
    }
    if (veoSeconds <= times[0]) return track.rotationVectors[0];
    if (veoSeconds >= times[last]) return track.rotationVectors[last];
    let low = 0;
    let high = last;
    while (high - low > 1) {
      const middle = (low + high) >> 1;
      if (times[middle] <= veoSeconds) low = middle; else high = middle;
    }
    // a longer hole between trusted samples cannot follow the mast's 1.5 s sway: refuse, as python does
    if (times[high] - times[low] > track.maximumGap && veoSeconds > times[low]) {
      throw Error(`Veo time ${veoSeconds} s falls in a ${(times[high] - times[low]).toFixed(2)} s hole in the measured drift`);
    }
    const fraction = (veoSeconds - times[low]) / (times[high] - times[low]);
    return [0, 1, 2].map(axis => track.rotationVectors[low][axis] + fraction * (track.rotationVectors[high][axis] - track.rotationVectors[low][axis]));
  }

  function rotationMatrix(vector) {  // rodrigues
    const angle = Math.hypot(...vector);
    if (angle < 1e-15) return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    const [x, y, z] = vector.map(value => value / angle);
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const t = 1 - c;
    return [[t * x * x + c, t * x * y - s * z, t * x * z + s * y],
            [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
            [t * x * z - s * y, t * y * z + s * x, t * z * z + c]];
  }

  function rigAt(track, veoSeconds) {
    const delta = rotationMatrix(rotationVectorAt(track, veoSeconds));
    const reference = track.reference.rotation;
    const rotation = reference.map(row => [0, 1, 2].map(column => row[0] * delta[0][column] + row[1] * delta[1][column] + row[2] * delta[2][column]));
    return {...track.reference, rotation};
  }

  // half row within a lens <-> native sensor row (src/calibration/veo_calibration.py VerticalMapping)
  function toNative(mapping, row) {
    return row <= mapping.knee_row ? row * mapping.top_scale
      : mapping.knee_row * mapping.top_scale + (row - mapping.knee_row) * mapping.bottom_scale;
  }

  function toRow(mapping, native) {
    const kneeNative = mapping.knee_row * mapping.top_scale;
    return native <= kneeNative ? native / mapping.top_scale : mapping.knee_row + (native - kneeNative) / mapping.bottom_scale;
  }

  function radialFactor(distortion, r2) {
    const [k1, k2, , , k3, k4, k5, k6] = distortion;
    return (1 + k1 * r2 + k2 * r2 * r2 + k3 * r2 * r2 * r2) / (1 + k4 * r2 + k5 * r2 * r2 + k6 * r2 * r2 * r2);
  }

  const multiply = (matrix, vector) => matrix.map(row => row[0] * vector[0] + row[1] * vector[1] + row[2] * vector[2]);
  const multiplyTransposed = (matrix, vector) => [0, 1, 2].map(column =>
    matrix[0][column] * vector[0] + matrix[1][column] * vector[1] + matrix[2][column] * vector[2]);
  const block = transform => transform.slice(0, 3).map(row => row.slice(0, 3));
  const translation = transform => transform.slice(0, 3).map(row => row[3]);

  // stacked-frame pixel -> the ray it looks along, in the RIG frame: which lens, a unit direction, and the
  // lens centre relative to the rig centre. needs only the lens model, not the rig's pose on the field
  function pixelToRigRay(rig, u, v) {
    const lens = v >= ROWS ? 1 : 0;
    const matrix = rig.cameraMatrices[lens];
    const distortedX = (u * rig.horizontalScale - matrix[0][2]) / matrix[0][0];
    const distortedY = (toNative(rig.verticalMapping, v - lens * ROWS) - matrix[1][2]) / matrix[1][1];
    let x = distortedX;
    let y = distortedY;
    for (let step = 0; step < UNDISTORT_ITERATIONS; step++) {  // the fixed point OpenCV iterates
      const factor = radialFactor(rig.distortions[lens], x * x + y * y);
      x = distortedX / factor;
      y = distortedY / factor;
    }
    const norm = Math.hypot(x, y, 1);
    return {lens, direction: multiply(block(rig.lensToRig[lens]), [x / norm, y / norm, 1 / norm]),
            origin: translation(rig.lensToRig[lens])};
  }

  // a point in one lens's own frame (x right, y down, z along its axis) -> where it lands in that lens's half of
  // the stacked frame, or null behind the lens or off the half. radiusSquared is the undistorted off-axis
  // distance squared: the rational model is only trusted below 4 (python's VeoRig.project uses the same cut)
  function lensPointToPixel(rig, lens, inLens) {
    if (inLens[2] <= 0) return null;
    const x = inLens[0] / inLens[2];
    const y = inLens[1] / inLens[2];
    const radiusSquared = x * x + y * y;
    const factor = radialFactor(rig.distortions[lens], radiusSquared);
    const matrix = rig.cameraMatrices[lens];
    const nativeU = matrix[0][0] * x * factor + matrix[0][2];
    const nativeV = matrix[1][1] * y * factor + matrix[1][2];
    const u = nativeU / rig.horizontalScale;
    const v = toRow(rig.verticalMapping, nativeV);
    if (!(u >= 0 && u < 2048 && v >= 0 && v < ROWS)) return null;
    return {u, v: v + lens * ROWS, closeness: inLens[2] / Math.hypot(...inLens), radiusSquared};
  }

  // stacked-frame pixel -> ground point in the Veo's field frame (metres), or null above the horizon
  function pixelToGround(rig, u, v) {
    const ray = pixelToRigRay(rig, u, v);
    const direction = multiply(rig.rotation, ray.direction);
    const origin = multiply(rig.rotation, ray.origin).map((value, axis) => value + rig.centre[axis]);
    if (direction[2] >= -1e-9) return null;
    const distance = -origin[2] / direction[2];
    return {x: origin[0] + distance * direction[0], y: origin[1] + distance * direction[1]};
  }

  // ground point (Veo frame) -> stacked-frame pixel in whichever lens sees it nearest its axis, or null
  function groundToPixel(rig, point) {
    const relative = [point.x - rig.centre[0], point.y - rig.centre[1], -rig.centre[2]];
    const inRig = multiplyTransposed(rig.rotation, relative);
    let best = null;
    for (const lens of [0, 1]) {
      const lensTranslation = translation(rig.lensToRig[lens]);
      const inLens = multiplyTransposed(block(rig.lensToRig[lens]), inRig.map((value, axis) => value - lensTranslation[axis]));
      const pixel = lensPointToPixel(rig, lens, inLens);
      if (pixel && (!best || pixel.closeness > best.closeness)) best = pixel;
    }
    return best && {u: best.u, v: best.v};
  }

  // the Veo's field frame (metres) -> the app's (x from end zone A, y from the bricks' sideline)
  function fieldToApp(point, fieldMetres, appField) {
    const endzone = appField.endzone;
    const goalA = fieldMetres.endzone_A_depth;
    const goalB = goalA + fieldMetres.central_zone_length;
    let x;
    if (point.x < goalA) x = (point.x / goalA) * endzone;
    else if (point.x <= goalB) x = endzone + ((point.x - goalA) / fieldMetres.central_zone_length) * (appField.length - 2 * endzone);
    else x = appField.length - endzone + ((point.x - goalB) / fieldMetres.endzone_B_depth) * endzone;
    return {x, y: ((fieldMetres.width - point.y) / fieldMetres.width) * appField.width};
  }

  function appToField(point, fieldMetres, appField) {
    const endzone = appField.endzone;
    const goalA = fieldMetres.endzone_A_depth;
    let x;
    if (point.x < endzone) x = (point.x / endzone) * goalA;
    else if (point.x <= appField.length - endzone) x = goalA + ((point.x - endzone) / (appField.length - 2 * endzone)) * fieldMetres.central_zone_length;
    else x = goalA + fieldMetres.central_zone_length + ((point.x - (appField.length - endzone)) / endzone) * fieldMetres.endzone_B_depth;
    return {x, y: fieldMetres.width - (point.y / appField.width) * fieldMetres.width};
  }

  const VeoView = {rigFromCalibration, trackFromCalibration, rotationVectorAt, rotationMatrix, rigAt, pixelToRigRay,
                   lensPointToPixel, pixelToGround, groundToPixel, fieldToApp, appToField};
  root.VeoView = VeoView;
  if (typeof module !== 'undefined' && module.exports) module.exports = VeoView;
})(typeof window !== 'undefined' ? window : globalThis);
