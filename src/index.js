
require("./compileShaders");

const Surface = require("./Surface");
const canvasPool = require("./canvasPool");
const toBlobSupported = require("./toBlobSupported");
const isSupportedCapture = require("./isSupportedCapture");

module.exports = {
  Surface,
  clearPool: canvasPool.clear,
  setPoolSize: canvasPool.setSize,
  toBlobSupported, // DEPRECATED
  isSupportedCapture
};
