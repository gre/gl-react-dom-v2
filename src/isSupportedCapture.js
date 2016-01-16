const toBlobSupported = require("./toBlobSupported");
module.exports = opts => {
  opts = {
    format: "base64",
    type: "png",
    quality: 1,
    ...opts
  };
  switch (opts.format) {
  case "base64": return true;
  case "blob": return toBlobSupported;
  default: return false;
  }
};
