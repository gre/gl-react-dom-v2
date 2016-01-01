module.exports = (canvas, opts) =>
  canvas.getContext("webgl", opts) ||
  canvas.getContext("webgl-experimental", opts) ||
  canvas.getContext("experimental-webgl", opts);
