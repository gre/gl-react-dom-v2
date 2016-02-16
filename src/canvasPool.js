const Cache = require("./GLCanvasCache");
const pointerEventsProperty = require("./pointerEventsProperty");
const getContext = require("./getContext");

let maxSizePool = 20;
const pool = [];

function setSize (size) {
  maxSizePool = size;
  pool.splice(size).forEach(p => p.dispose(true));
}

function clear () {
  pool.splice(0).forEach(p => p.dispose(true));
}

function create (parentNode) {
  let poolObject;

  if (pool.length > 0) {
    // reuse most recently used canvas
    poolObject = pool.splice(pool.length-1)[0];
  }
  else {
    // create a new canvas / context
    const canvas = document.createElement("canvas");
    canvas.style[pointerEventsProperty] = "none";
    canvas.style.width = "100%";
    canvas.style.height = "100%";

    const opts = {};
    const gl = getContext(canvas, opts);

    if (!gl) return null;

    const dispose = dontReuse => {
      if (canvas.parentNode) {
        canvas.parentNode.removeChild(canvas);
      }
      const reachPoolLimit = pool.length >= maxSizePool;
      if (reachPoolLimit) {
        console.warn( // eslint-disable-line no-console
          `gl-react-dom: canvasPool of size ${maxSizePool} reached, you might want to increase pool size, use less concurrent WebGL Canvases or consider using gl-react-dom-static-container library`);
      }
      if (!dontReuse && !reachPoolLimit && pool.indexOf(poolObject) === -1) {
        pool.push(poolObject);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.clearColor(0.0, 0.0, 0.0, 0.0);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      else {
        poolObject.cache.dispose();
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
      }
      if (h !== _h || scaleChanged) {
        _h = h;
        canvas.height = scale * h;
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
  create,
  clear,
  setSize
};
