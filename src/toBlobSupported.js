module.exports =
  typeof URL !== "undefined" &&
  typeof URL.createObjectURL === "function" &&
  typeof HTMLCanvasElement.prototype.toBlob === "function";
