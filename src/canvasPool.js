const Cache = require("./GLCanvasCache");
const pointerEventsProperty = require("./pointerEventsProperty");

const maxSizePool = 20;
const pool = [];

function create (parentNode) {
  let poolObject;

  if (pool.length > 0) {
    poolObject = pool.splice(0, 1)[0];
  }
  else {
    const canvas = document.createElement("canvas");
    canvas.style[pointerEventsProperty] = "none";

    const opts = {};
    const gl = (
      canvas.getContext("webgl", opts) ||
      canvas.getContext("webgl-experimental", opts) ||
      canvas.getContext("experimental-webgl", opts)
    );

    const dispose = () => {
      if (canvas.parentNode) {
        canvas.parentNode.removeChild(canvas);
      }
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.clearColor(0.0, 0.0, 0.0, 0.0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (pool.length < maxSizePool && pool.indexOf(poolObject) === -1)
        pool.push(poolObject);
      else {
        pool.cache.dispose();
      }
    };

    let _w = -1, _h = -1, _s = -1;
    const resize = (w, h, scale) => {
      const scaleChanged = scale !== _s;
      if (scaleChanged) {
        _s = scale;
      }
      if (w !== _w || scaleChanged) {
        _w = w;
        canvas.width = scale * w;
        canvas.style.width = w+"px";
      }
      if (h !== _h || scaleChanged) {
        _h = h;
        canvas.height = scale * h;
        canvas.style.height = h+"px";
      }
    };

    poolObject = {
      canvas,
      gl,
      dispose,
      resize,
      cache: new Cache(gl)
    };
  }

  parentNode.appendChild(poolObject.canvas);

  return poolObject;
}

module.exports = {
  create
};
