
if (process.env.NODE_ENV !== "production") {
  require("./debugShaders");
}

const Surface = require("./Surface");
const canvasPool = require("./canvasPool");

module.exports = {
  Surface,
  clearPool: canvasPool.clear,
  setPoolSize: canvasPool.setSize
};
