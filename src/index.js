
require("./compileShaders");

const Surface = require("./Surface");
const canvasPool = require("./canvasPool");
const toBlobSupported = require("./toBlobSupported");

module.exports = {
  Surface,
  clearPool: canvasPool.clear,
  setPoolSize: canvasPool.setSize,
  toBlobSupported
};
