
if (process.env.NODE_ENV !== "production") {
  require("./debugShaders");
}

const Surface = require("./Surface");
const canvasPool = require("./canvasPool");
const toBlobSupported = require("./toBlobSupported");

module.exports = {
  Surface,
  clearPool: canvasPool.clear,
  setPoolSize: canvasPool.setSize,
  toBlobSupported
};
